package admin

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode"

	"github.com/revtex/squelch/internal/db"
)

// UnitImportRow is one unit read from a CSV.
type UnitImportRow struct {
	Row    int     `json:"row"`
	UnitID int64   `json:"unitId"`
	Label  *string `json:"label,omitempty"`
	Order  *int64  `json:"order,omitempty"`
}

// UnitImportPreviewRow is a parsed unit judged against the system.
type UnitImportPreviewRow struct {
	UnitImportRow
	Status  string         `json:"status"`
	Changes []ImportChange `json:"changes"`
}

// UnitImportPreview is what the import wizard's review step shows for units.
type UnitImportPreview struct {
	Rows      []UnitImportPreviewRow `json:"rows"`
	Problems  []ImportProblem        `json:"problems"`
	New       int                    `json:"new"`
	Unchanged int                    `json:"unchanged"`
	Changed   int                    `json:"changed"`
} // @name UnitImportPreview

func readCSV(r io.Reader) ([][]string, error) {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = -1
	reader.TrimLeadingSpace = true
	reader.LazyQuotes = true
	records, err := reader.ReadAll()
	if err != nil {
		return nil, errors.New("the file is not valid CSV")
	}
	if len(records) == 0 {
		return nil, errors.New("the file is empty")
	}
	return records, nil
}

func csvCell(rec []string, i int) string {
	if i < 0 || i >= len(rec) {
		return ""
	}
	return strings.TrimSpace(rec[i])
}

func blankRecord(rec []string) bool {
	return len(rec) == 0 || (len(rec) == 1 && strings.TrimSpace(rec[0]) == "")
}

// ParseUnitCSV reads a unit CSV: unit_id, label, order, with or without a
// header (radio_id, dec, alpha_tag and priority are taken too). An "all
// systems" export's system column is ignored.
func ParseUnitCSV(r io.Reader) (rows []UnitImportRow, problems []ImportProblem, err error) {
	records, err := readCSV(r)
	if err != nil {
		return nil, nil, err
	}
	idCol, labelCol, orderCol := 0, 1, 2
	start := 0
	first := strings.TrimSpace(records[0][0])
	if first != "" && !unicode.IsDigit(rune(first[0])) {
		idCol, labelCol, orderCol = -1, -1, -1
		start = 1
		for i, raw := range records[0] {
			switch strings.ToLower(strings.TrimSpace(raw)) {
			case "unit_id", "radio_id", "dec", "unit id", "unitid", "id":
				idCol = i
			case "label", "alpha_tag", "alpha tag", "name":
				labelCol = i
			case "order", "priority":
				orderCol = i
			}
		}
		if idCol < 0 {
			return nil, nil, errors.New("no unit id column was found (unit_id, radio_id or dec)")
		}
	}
	for i := start; i < len(records); i++ {
		rec := records[i]
		rowNum := i + 1
		if blankRecord(rec) {
			continue
		}
		if len(rows) >= MaxImportRows {
			problems = append(problems, ImportProblem{Row: rowNum, Reason: "the file has more rows than an import takes"})
			break
		}
		idRaw := csvCell(rec, idCol)
		if idRaw == "" {
			problems = append(problems, ImportProblem{Row: rowNum, Reason: "unit id is missing"})
			continue
		}
		id, perr := strconv.ParseInt(idRaw, 10, 64)
		if perr != nil || id < 0 {
			problems = append(problems, ImportProblem{Row: rowNum, Reason: "unit id is not a number"})
			continue
		}
		row := UnitImportRow{Row: rowNum, UnitID: id}
		if v := csvCell(rec, labelCol); v != "" {
			row.Label = &v
		}
		if v := csvCell(rec, orderCol); v != "" {
			if n, oerr := strconv.ParseInt(v, 10, 64); oerr == nil {
				row.Order = &n
			}
		}
		rows = append(rows, row)
	}
	return rows, problems, nil
}

// PreviewUnitImport judges parsed rows against a system's units.
func PreviewUnitImport(ctx context.Context, q *db.Queries, systemID int64, rows []UnitImportRow, problems []ImportProblem) (UnitImportPreview, error) {
	existing, err := q.ListUnitsBySystem(ctx, systemID)
	if err != nil {
		return UnitImportPreview{}, fmt.Errorf("failed to list units: %w", err)
	}
	byID := make(map[int64]db.Unit, len(existing))
	for _, u := range existing {
		byID[u.UnitID] = u
	}
	out := UnitImportPreview{Rows: []UnitImportPreviewRow{}, Problems: problems}
	if out.Problems == nil {
		out.Problems = []ImportProblem{}
	}
	seen := map[int64]bool{}
	for _, row := range rows {
		if seen[row.UnitID] {
			out.Problems = append(out.Problems, ImportProblem{Row: row.Row, Reason: fmt.Sprintf("unit %d appears more than once; the first row wins", row.UnitID)})
			continue
		}
		seen[row.UnitID] = true
		pr := UnitImportPreviewRow{UnitImportRow: row, Changes: []ImportChange{}}
		u, ok := byID[row.UnitID]
		if !ok {
			pr.Status = "new"
			out.New++
			out.Rows = append(out.Rows, pr)
			continue
		}
		if row.Label != nil && !strings.EqualFold(u.Label.String, *row.Label) {
			pr.Changes = append(pr.Changes, ImportChange{Field: "label", Now: u.Label.String, After: *row.Label})
		}
		if len(pr.Changes) == 0 {
			pr.Status = "unchanged"
			out.Unchanged++
		} else {
			pr.Status = "changed"
			out.Changed++
		}
		out.Rows = append(out.Rows, pr)
	}
	return out, nil
}

// UnitsImport applies unit rows from the wizard to a system. Mode "fill"
// labels only units with no label yet; "overwrite" replaces labels with
// what the file has. New units are always created.
func (o *Operations) UnitsImport(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		SystemID int64           `json:"systemId"`
		Mode     string          `json:"mode"`
		Rows     []UnitImportRow `json:"rows"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.SystemID <= 0 {
		return nil, UserError("systemId is required")
	}
	if req.Mode == "" {
		req.Mode = "fill"
	}
	if req.Mode != "fill" && req.Mode != "overwrite" {
		return nil, UserError("mode must be fill or overwrite")
	}
	if len(req.Rows) == 0 {
		return nil, UserError("there are no rows to import")
	}
	if len(req.Rows) > MaxImportRows {
		return nil, UserError("too many rows at once")
	}
	system, err := o.Queries.GetSystem(ctx, req.SystemID)
	if err != nil {
		return nil, UserError("system not found")
	}
	overwrite := req.Mode == "overwrite"
	created, updated, unchanged := 0, 0, 0
	seen := map[int64]bool{}
	for _, row := range req.Rows {
		if seen[row.UnitID] {
			continue
		}
		seen[row.UnitID] = true
		u, err := o.Queries.GetUnitBySystemAndUnitID(ctx, db.GetUnitBySystemAndUnitIDParams{SystemID: req.SystemID, UnitID: row.UnitID})
		if err != nil {
			var order int64
			if row.Order != nil {
				order = *row.Order
			}
			if _, err := o.Queries.CreateUnit(ctx, db.CreateUnitParams{SystemID: req.SystemID, UnitID: row.UnitID, Label: ptrToNullStr(trimPtr(row.Label)), Order: order}); err != nil {
				return nil, fmt.Errorf("create unit %d: %w", row.UnitID, err)
			}
			created++
			continue
		}
		label := trimPtr(row.Label)
		if label == nil || (!overwrite && strings.TrimSpace(u.Label.String) != "") || u.Label.String == *label {
			unchanged++
			continue
		}
		if err := o.Queries.UpdateUnit(ctx, db.UpdateUnitParams{ID: u.ID, UnitID: u.UnitID, Label: ptrToNullStr(label), Order: u.Order}); err != nil {
			return nil, fmt.Errorf("update unit %d: %w", row.UnitID, err)
		}
		updated++
	}
	o.audit(ctx, fmt.Sprintf("admin: units imported into system %q by %s: %d created, %d updated, %d unchanged (%s)",
		system.Label, o.callerName(ctx, callerID), created, updated, unchanged, req.Mode))
	o.broadcastAdminEvent("units.updated", nil)
	return map[string]any{"ok": true, "created": created, "updated": updated, "unchanged": unchanged}, nil
}

// LabelImportRow is one group or tag label read from a CSV, judged
// against what exists: new or unchanged.
type LabelImportRow struct {
	Row    int    `json:"row"`
	Label  string `json:"label"`
	Status string `json:"status"`
}

// LabelImportPreview is what the import wizard's review step shows for
// groups and tags.
type LabelImportPreview struct {
	Rows      []LabelImportRow `json:"rows"`
	Problems  []ImportProblem  `json:"problems"`
	New       int              `json:"new"`
	Unchanged int              `json:"unchanged"`
} // @name LabelImportPreview

// ParseLabelCSV reads one label per row, from a "label" column when there
// is a header and the first column otherwise.
func ParseLabelCSV(r io.Reader) (labels []LabelImportRow, problems []ImportProblem, err error) {
	records, err := readCSV(r)
	if err != nil {
		return nil, nil, err
	}
	col, start := 0, 0
	for i, raw := range records[0] {
		if h := strings.ToLower(strings.TrimSpace(raw)); h == "label" || h == "name" || h == "group" || h == "tag" {
			col, start = i, 1
			break
		}
	}
	for i := start; i < len(records); i++ {
		rec := records[i]
		rowNum := i + 1
		if blankRecord(rec) {
			continue
		}
		if len(labels) >= MaxImportRows {
			problems = append(problems, ImportProblem{Row: rowNum, Reason: "the file has more rows than an import takes"})
			break
		}
		label := csvCell(rec, col)
		if label == "" {
			problems = append(problems, ImportProblem{Row: rowNum, Reason: "label is missing"})
			continue
		}
		if len(label) > 64 {
			problems = append(problems, ImportProblem{Row: rowNum, Reason: "label must be 64 characters or fewer"})
			continue
		}
		labels = append(labels, LabelImportRow{Row: rowNum, Label: label})
	}
	return labels, problems, nil
}

// PreviewLabelImport marks each parsed label new or unchanged against the
// labels that exist, ignoring case, and flags repeats in the file.
func PreviewLabelImport(existing []string, rows []LabelImportRow, problems []ImportProblem) LabelImportPreview {
	have := make(map[string]bool, len(existing))
	for _, l := range existing {
		have[strings.ToLower(l)] = true
	}
	out := LabelImportPreview{Rows: []LabelImportRow{}, Problems: problems}
	if out.Problems == nil {
		out.Problems = []ImportProblem{}
	}
	seen := map[string]bool{}
	for _, row := range rows {
		key := strings.ToLower(row.Label)
		if seen[key] {
			out.Problems = append(out.Problems, ImportProblem{Row: row.Row, Reason: fmt.Sprintf("%q appears more than once; the first row wins", row.Label)})
			continue
		}
		seen[key] = true
		if have[key] {
			row.Status = "unchanged"
			out.Unchanged++
		} else {
			row.Status = "new"
			out.New++
		}
		out.Rows = append(out.Rows, row)
	}
	return out
}

type labelImportRequest struct {
	Labels []string `json:"labels"`
}

func (o *Operations) labelsImport(ctx context.Context, params json.RawMessage, callerID int64, kind string,
	existing func(context.Context) ([]string, error), create func(context.Context, string) error, topic string,
) (any, error) {
	var req labelImportRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if len(req.Labels) == 0 {
		return nil, UserError("there are no rows to import")
	}
	if len(req.Labels) > MaxImportRows {
		return nil, UserError("too many rows at once")
	}
	have, err := existing(ctx)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]bool, len(have))
	for _, l := range have {
		seen[strings.ToLower(l)] = true
	}
	created, unchanged := 0, 0
	for _, raw := range req.Labels {
		label, err := checkLabel(raw)
		if err != nil {
			return nil, err
		}
		key := strings.ToLower(label)
		if seen[key] {
			unchanged++
			continue
		}
		if err := create(ctx, label); err != nil {
			return nil, fmt.Errorf("create %s %q: %w", kind, label, err)
		}
		seen[key] = true
		created++
	}
	o.audit(ctx, fmt.Sprintf("admin: %ss imported by %s: %d created, %d already there", kind, o.callerName(ctx, callerID), created, unchanged))
	o.broadcastAdminEvent(topic, nil)
	return map[string]any{"ok": true, "created": created, "unchanged": unchanged}, nil
}

// GroupsImport creates the groups from a reviewed CSV that do not exist yet.
func (o *Operations) GroupsImport(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	return o.labelsImport(ctx, params, callerID, "group",
		func(ctx context.Context) ([]string, error) {
			gs, err := o.Queries.ListGroups(ctx)
			if err != nil {
				return nil, fmt.Errorf("failed to list groups: %w", err)
			}
			return groupLabels(gs), nil
		},
		func(ctx context.Context, label string) error { _, err := o.Queries.CreateGroup(ctx, label); return err },
		"groups.updated")
}

// TagsImport creates the tags from a reviewed CSV that do not exist yet.
func (o *Operations) TagsImport(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	return o.labelsImport(ctx, params, callerID, "tag",
		func(ctx context.Context) ([]string, error) {
			ts, err := o.Queries.ListTags(ctx)
			if err != nil {
				return nil, fmt.Errorf("failed to list tags: %w", err)
			}
			return tagLabels(ts), nil
		},
		func(ctx context.Context, label string) error { _, err := o.Queries.CreateTag(ctx, label); return err },
		"tags.updated")
}
