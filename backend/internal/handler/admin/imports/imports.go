// Package imports provides the admin CSV import endpoints
// (talkgroups, units, groups, tags).
package imports

import (
	"context"
	"database/sql"
	"encoding/csv"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"unicode"

	"github.com/gin-gonic/gin"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/handler/shared"
)

// AdminBroadcaster is the subset of ws.Hub used to broadcast admin events.
type AdminBroadcaster interface {
	BroadcastAdminEvent(event string, payload any)
}

// Handler serves the admin CSV import endpoints.
type Handler struct {
	queries *db.Queries
	hub     AdminBroadcaster
}

// New constructs an imports Handler.
func New(queries *db.Queries, hub AdminBroadcaster) *Handler {
	return &Handler{queries: queries, hub: hub}
}

// tgColumnMap maps logical field names to their CSV column index.
// A value of -1 means the column is not present.
type tgColumnMap struct {
	talkgroupID int
	label       int
	name        int
	tagID       int // Squelch integer FK
	groupID     int // Squelch integer FK
	tagName     int // rdio-scanner text name (resolved to FK)
	groupName   int // rdio-scanner text name (resolved to FK)
	frequency   int
	led         int
	order       int
}

// detectTgColumns inspects a header row and returns a column map.
// Returns nil if the row doesn't look like a header (first cell is a digit).
func detectTgColumns(header []string) *tgColumnMap {
	if len(header) == 0 {
		return nil
	}
	first := strings.TrimSpace(header[0])
	if len(first) > 0 && unicode.IsDigit(rune(first[0])) {
		return nil // not a header row
	}

	m := &tgColumnMap{
		talkgroupID: -1, label: -1, name: -1,
		tagID: -1, groupID: -1, tagName: -1, groupName: -1,
		frequency: -1, led: -1, order: -1,
	}

	for i, raw := range header {
		col := strings.ToLower(strings.TrimSpace(raw))
		switch col {
		case "talkgroup_id", "dec", "decimal":
			m.talkgroupID = i
		case "label", "alpha_tag", "alpha tag":
			m.label = i
		case "name", "description":
			m.name = i
		case "tag_id":
			m.tagID = i
		case "group_id":
			m.groupID = i
		case "tag":
			m.tagName = i
		// A RadioReference export's Category is the agency or county: the
		// group, as the import wizard and rdio-scanner read it.
		case "group", "service_type", "category":
			m.groupName = i
		case "frequency", "freq":
			m.frequency = i
		case "led", "led_color", "color":
			m.led = i
		case "order", "priority":
			m.order = i
		}
	}
	return m
}

func defaultTgColumns() *tgColumnMap {
	return &tgColumnMap{
		talkgroupID: 0, label: 1, name: 2,
		tagID: 3, groupID: 4, tagName: -1, groupName: -1,
		frequency: 5, led: 6, order: 7,
	}
}

func col(record []string, i int) string {
	if i < 0 || i >= len(record) {
		return ""
	}
	return strings.TrimSpace(record[i])
}

// ImportTalkgroups handles POST /api/admin/import/talkgroups.
//
//	@Summary      Import talkgroups from CSV
//	@Description  Accepts a multipart CSV file with talkgroup data and a system_id form field. Supports Squelch format (talkgroup_id, label, name, tag_id, group_id, frequency, led, order), rdio-scanner format (dec, hex, alpha_tag, description, tag, group, priority) and RadioReference format (Decimal, Alpha Tag, Description, Tag, Category; Category becomes the group). Header rows are auto-detected; tag/group names are resolved to IDs automatically. Use mode=overwrite (default) to update existing talkgroups or mode=skip to leave existing talkgroups unchanged.
//	@Tags         Admin,v1-Admin
//	@Accept       multipart/form-data
//	@Produce      json
//	@Param        system_id  formData  int     true   "System ID to import talkgroups into"
//	@Param        file       formData  file    true   "CSV file"
//	@Param        mode       formData  string  false  "Duplicate handling: overwrite (default) or skip"
//	@Success      200  {object}  object  "inserted, updated, skipped counts"
//	@Failure      400  {object}  shared.ErrorResponse
//	@Failure      500  {object}  shared.ErrorResponse
//	@Security     BearerAuth
//	@Router       /admin/import/talkgroups [post]
//	@Router       /v1/admin/import/talkgroups [post]
func (h *Handler) ImportTalkgroups(c *gin.Context) {
	ctx := c.Request.Context()

	systemIDStr := c.PostForm("system_id")
	if systemIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "system_id is required"})
		return
	}
	systemID, err := strconv.ParseInt(systemIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid system_id"})
		return
	}

	if _, err := h.queries.GetSystem(ctx, systemID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "system not found"})
		return
	}

	mode := c.DefaultPostForm("mode", "overwrite")
	if mode != "overwrite" && mode != "skip" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "mode must be 'overwrite' or 'skip'"})
		return
	}

	file, _, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}
	defer file.Close()

	reader := csv.NewReader(file)
	reader.FieldsPerRecord = -1
	reader.TrimLeadingSpace = true

	var columns *tgColumnMap
	var firstDataRow []string
	for {
		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			slog.Warn("talkgroup import: file is empty", "system_id", systemID)
			c.JSON(http.StatusOK, gin.H{
				"inserted": 0, "updated": 0, "skipped": 0, "failed": 0,
				"message": "file is empty",
			})
			return
		}
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid CSV format"})
			return
		}
		if len(record) == 0 || (len(record) == 1 && strings.TrimSpace(record[0]) == "") {
			continue
		}
		columns = detectTgColumns(record)
		if columns == nil {
			columns = defaultTgColumns()
			firstDataRow = record
		}
		break
	}

	if columns.talkgroupID < 0 {
		slog.Warn("talkgroup import: no talkgroup_id column detected",
			"system_id", systemID)
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "CSV header has no talkgroup_id / dec / decimal column; " +
				"cannot import without knowing which column holds the talkgroup ID",
		})
		return
	}

	var inserted, updated, skipped, failed int

	processRow := func(record []string) error {
		tgIDStr := col(record, columns.talkgroupID)
		tgID, err := strconv.ParseInt(tgIDStr, 10, 64)
		if err != nil {
			failed++
			return nil //nolint:nilerr
		}

		_, existsErr := h.queries.GetTalkgroupBySystemAndTGID(ctx, db.GetTalkgroupBySystemAndTGIDParams{
			SystemID:    systemID,
			TalkgroupID: tgID,
		})
		exists := !errors.Is(existsErr, sql.ErrNoRows)

		if exists && mode == "skip" {
			skipped++
			return nil
		}

		params := db.UpsertTalkgroupParams{
			SystemID:    systemID,
			TalkgroupID: tgID,
		}

		if v := col(record, columns.label); v != "" {
			params.Label = sql.NullString{String: v, Valid: true}
		}
		if v := col(record, columns.name); v != "" {
			params.Name = sql.NullString{String: v, Valid: true}
		}

		if v := col(record, columns.tagID); v != "" {
			if id, err := strconv.ParseInt(v, 10, 64); err == nil {
				if _, gerr := h.queries.GetTag(ctx, id); gerr == nil {
					params.TagID = sql.NullInt64{Int64: id, Valid: true}
				} else if name := col(record, columns.tagName); name != "" {
					params.TagID = shared.ResolveTagID(ctx, h.queries, name)
				}
			}
		} else if v := col(record, columns.tagName); v != "" {
			params.TagID = shared.ResolveTagID(ctx, h.queries, v)
		}

		if v := col(record, columns.groupID); v != "" {
			if id, err := strconv.ParseInt(v, 10, 64); err == nil {
				if _, gerr := h.queries.GetGroup(ctx, id); gerr == nil {
					params.GroupID = sql.NullInt64{Int64: id, Valid: true}
				} else if name := col(record, columns.groupName); name != "" {
					params.GroupID = shared.ResolveGroupID(ctx, h.queries, name)
				}
			}
		} else if v := col(record, columns.groupName); v != "" {
			params.GroupID = shared.ResolveGroupID(ctx, h.queries, v)
		}

		if v := col(record, columns.frequency); v != "" {
			if id, err := strconv.ParseInt(v, 10, 64); err == nil {
				params.Frequency = sql.NullInt64{Int64: id, Valid: true}
			}
		}
		if v := col(record, columns.led); v != "" {
			params.Led = sql.NullString{String: v, Valid: true}
		}
		if v := col(record, columns.order); v != "" {
			if id, err := strconv.ParseInt(v, 10, 64); err == nil {
				params.Order = id
			}
		}

		if err := h.queries.UpsertTalkgroup(ctx, params); err != nil {
			return err
		}
		if exists {
			updated++
		} else {
			inserted++
		}
		return nil
	}

	if firstDataRow != nil {
		if err := processRow(firstDataRow); err != nil {
			slog.Error("failed to upsert talkgroup", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database error"})
			return
		}
	}

	for {
		if inserted+updated+skipped >= shared.MaxImportRows {
			slog.Warn("CSV import row limit reached", "limit", shared.MaxImportRows)
			break
		}

		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			slog.Error("csv read error", "error", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid CSV format"})
			return
		}
		if len(record) == 0 || (len(record) == 1 && strings.TrimSpace(record[0]) == "") {
			continue
		}

		if err := processRow(record); err != nil {
			slog.Error("failed to upsert talkgroup", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database error"})
			return
		}
	}

	slog.Info("talkgroups imported", "system_id", systemID,
		"inserted", inserted, "updated", updated, "skipped", skipped, "failed", failed)
	c.JSON(http.StatusOK, gin.H{
		"inserted": inserted,
		"updated":  updated,
		"skipped":  skipped,
		"failed":   failed,
	})
}

// ImportUnits handles POST /api/admin/import/units.
//
//	@Summary      Import units from CSV
//	@Description  Accepts a multipart CSV file with unit data and a system_id form field. Columns: unit_id, label, order. Header rows are auto-skipped. Use mode=overwrite (default) to update existing units or mode=skip to leave existing units unchanged.
//	@Tags         Admin,v1-Admin
//	@Accept       multipart/form-data
//	@Produce      json
//	@Param        system_id  formData  int     true   "System ID to import units into"
//	@Param        file       formData  file    true   "CSV file"
//	@Param        mode       formData  string  false  "Duplicate handling: overwrite (default) or skip"
//	@Success      200  {object}  object  "inserted, updated, skipped counts"
//	@Failure      400  {object}  shared.ErrorResponse
//	@Failure      500  {object}  shared.ErrorResponse
//	@Security     BearerAuth
//	@Router       /admin/import/units [post]
//	@Router       /v1/admin/import/units [post]
func (h *Handler) ImportUnits(c *gin.Context) {
	ctx := c.Request.Context()

	systemIDStr := c.PostForm("system_id")
	if systemIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "system_id is required"})
		return
	}
	systemID, err := strconv.ParseInt(systemIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid system_id"})
		return
	}

	if _, err := h.queries.GetSystem(ctx, systemID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "system not found"})
		return
	}

	mode := c.DefaultPostForm("mode", "overwrite")
	if mode != "overwrite" && mode != "skip" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "mode must be 'overwrite' or 'skip'"})
		return
	}

	file, _, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}
	defer file.Close()

	reader := csv.NewReader(file)
	reader.FieldsPerRecord = -1
	reader.TrimLeadingSpace = true

	unitIDCol, labelCol, orderCol := 0, 1, 2
	var firstDataRow []string

	for {
		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			slog.Warn("unit import: file is empty", "system_id", systemID)
			c.JSON(http.StatusOK, gin.H{
				"inserted": 0, "updated": 0, "skipped": 0, "failed": 0,
				"message": "file is empty",
			})
			return
		}
		if err != nil {
			slog.Error("csv read error", "error", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid CSV format"})
			return
		}
		if len(record) == 0 || (len(record) == 1 && strings.TrimSpace(record[0]) == "") {
			continue
		}

		col0 := strings.TrimSpace(record[0])
		if len(col0) > 0 && !unicode.IsDigit(rune(col0[0])) {
			unitIDCol, labelCol, orderCol = -1, -1, -1
			for i, raw := range record {
				switch strings.ToLower(strings.TrimSpace(raw)) {
				case "unit_id", "radio_id", "dec":
					unitIDCol = i
				case "label", "alpha_tag", "name":
					labelCol = i
				case "order", "priority":
					orderCol = i
				}
			}
			if unitIDCol < 0 {
				c.JSON(http.StatusBadRequest, gin.H{
					"error": "CSV header has no unit_id column",
				})
				return
			}
		} else {
			firstDataRow = record
		}
		break
	}

	var inserted, updated, skipped, failed int

	processUnitRow := func(record []string) error {
		unitIDStr := col(record, unitIDCol)
		unitID, perr := strconv.ParseInt(unitIDStr, 10, 64)
		if perr != nil {
			failed++
			return nil //nolint:nilerr
		}

		_, existsErr := h.queries.GetUnitBySystemAndUnitID(ctx, db.GetUnitBySystemAndUnitIDParams{
			SystemID: systemID,
			UnitID:   unitID,
		})
		exists := !errors.Is(existsErr, sql.ErrNoRows)

		if exists && mode == "skip" {
			skipped++
			return nil
		}

		params := db.UpsertUnitParams{
			SystemID: systemID,
			UnitID:   unitID,
		}
		if v := col(record, labelCol); v != "" {
			params.Label = sql.NullString{String: v, Valid: true}
		}
		if v := col(record, orderCol); v != "" {
			if n, err := strconv.ParseInt(v, 10, 64); err == nil {
				params.Order = n
			}
		}

		if err := h.queries.UpsertUnit(ctx, params); err != nil {
			return err
		}
		if exists {
			updated++
		} else {
			inserted++
		}
		return nil
	}

	if firstDataRow != nil {
		if err := processUnitRow(firstDataRow); err != nil {
			slog.Error("failed to upsert unit", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database error"})
			return
		}
	}

	for {
		if inserted+updated+skipped >= shared.MaxImportRows {
			slog.Warn("CSV import row limit reached", "limit", shared.MaxImportRows)
			break
		}
		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			slog.Error("csv read error", "error", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid CSV format"})
			return
		}
		if len(record) == 0 || (len(record) == 1 && strings.TrimSpace(record[0]) == "") {
			continue
		}
		if err := processUnitRow(record); err != nil {
			slog.Error("failed to upsert unit", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database error"})
			return
		}
	}

	slog.Info("units imported", "system_id", systemID,
		"inserted", inserted, "updated", updated, "skipped", skipped, "failed", failed)
	c.JSON(http.StatusOK, gin.H{
		"inserted": inserted,
		"updated":  updated,
		"skipped":  skipped,
		"failed":   failed,
	})
}

// importLabelOnly is the shared core for groups and tags.
func (h *Handler) importLabelOnly(c *gin.Context, kind string,
	getByLabel func(ctx context.Context, label string) (int64, bool, error),
	create func(ctx context.Context, label string) error,
) {
	ctx := c.Request.Context()

	file, _, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}
	defer file.Close()

	reader := csv.NewReader(file)
	reader.FieldsPerRecord = -1
	reader.TrimLeadingSpace = true

	labelCol := 0
	headerSeen := false

	var inserted, skipped, failed int

	processRow := func(record []string) {
		if labelCol >= len(record) {
			failed++
			return
		}
		label := strings.TrimSpace(record[labelCol])
		if label == "" {
			failed++
			return
		}
		if _, ok, gerr := getByLabel(ctx, label); gerr != nil {
			slog.Warn(kind+" import: lookup failed", "label", label, "error", gerr)
			failed++
			return
		} else if ok {
			skipped++
			return
		}
		if cerr := create(ctx, label); cerr != nil {
			slog.Warn(kind+" import: create failed", "label", label, "error", cerr)
			failed++
			return
		}
		inserted++
	}

	for {
		if inserted+skipped >= shared.MaxImportRows {
			slog.Warn("CSV import row limit reached", "limit", shared.MaxImportRows)
			break
		}
		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid CSV format"})
			return
		}
		if len(record) == 0 || (len(record) == 1 && strings.TrimSpace(record[0]) == "") {
			continue
		}

		if !headerSeen {
			headerSeen = true
			first := strings.ToLower(strings.TrimSpace(record[0]))
			if first == "label" || first == "name" || first == "tag" || first == "group" {
				for i, raw := range record {
					col := strings.ToLower(strings.TrimSpace(raw))
					if col == "label" || col == "name" || col == "tag" || col == "group" {
						labelCol = i
						break
					}
				}
				continue
			}
		}

		processRow(record)
	}

	if inserted == 0 && skipped == 0 && failed == 0 {
		slog.Warn(kind + " import: file is empty")
		c.JSON(http.StatusOK, gin.H{
			"inserted": 0, "skipped": 0, "failed": 0,
			"message": "file is empty",
		})
		return
	}

	slog.Info(kind+" imported", "inserted", inserted, "skipped", skipped, "failed", failed)
	if h.hub != nil {
		h.hub.BroadcastAdminEvent(kind+".updated", nil)
	}
	c.JSON(http.StatusOK, gin.H{
		"inserted": inserted,
		"skipped":  skipped,
		"failed":   failed,
	})
}

// ImportGroups handles POST /api/admin/import/groups.
//
//	@Summary		Import groups from CSV
//	@Description	Accepts a multipart CSV file with a single 'label' column (header optional). Existing labels are skipped; new labels are inserted.
//	@Tags			Admin,v1-Admin
//	@Accept			multipart/form-data
//	@Produce		json
//	@Param			file	formData	file	true	"CSV file"
//	@Success		200		{object}	object	"inserted, skipped, failed counts"
//	@Failure		400		{object}	shared.ErrorResponse
//	@Failure		500		{object}	shared.ErrorResponse
//	@Security		BearerAuth
//	@Router			/admin/import/groups [post]
//	@Router			/v1/admin/import/groups [post]
func (h *Handler) ImportGroups(c *gin.Context) {
	h.importLabelOnly(c, "groups",
		func(ctx context.Context, label string) (int64, bool, error) {
			g, err := h.queries.GetGroupByLabel(ctx, label)
			if errors.Is(err, sql.ErrNoRows) {
				return 0, false, nil
			}
			if err != nil {
				return 0, false, err
			}
			return g.ID, true, nil
		},
		func(ctx context.Context, label string) error {
			_, err := h.queries.CreateGroup(ctx, label)
			return err
		},
	)
}

// ImportTags handles POST /api/admin/import/tags.
//
//	@Summary		Import tags from CSV
//	@Description	Accepts a multipart CSV file with a single 'label' column (header optional). Existing labels are skipped; new labels are inserted.
//	@Tags			Admin,v1-Admin
//	@Accept			multipart/form-data
//	@Produce		json
//	@Param			file	formData	file	true	"CSV file"
//	@Success		200		{object}	object	"inserted, skipped, failed counts"
//	@Failure		400		{object}	shared.ErrorResponse
//	@Failure		500		{object}	shared.ErrorResponse
//	@Security		BearerAuth
//	@Router			/admin/import/tags [post]
//	@Router			/v1/admin/import/tags [post]
func (h *Handler) ImportTags(c *gin.Context) {
	h.importLabelOnly(c, "tags",
		func(ctx context.Context, label string) (int64, bool, error) {
			t, err := h.queries.GetTagByLabel(ctx, label)
			if errors.Is(err, sql.ErrNoRows) {
				return 0, false, nil
			}
			if err != nil {
				return 0, false, err
			}
			return t.ID, true, nil
		},
		func(ctx context.Context, label string) error {
			_, err := h.queries.CreateTag(ctx, label)
			return err
		},
	)
}
