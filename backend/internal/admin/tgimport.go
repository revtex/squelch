package admin

import (
	"context"
	"database/sql"
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

// ImportRow is one talkgroup read from a CSV, in the words the file used:
// group and tag are names, resolved (and created) when applied.
type ImportRow struct {
	Row         int     `json:"row"`
	TalkgroupID int64   `json:"talkgroupId"`
	Label       *string `json:"label,omitempty"`
	Name        *string `json:"name,omitempty"`
	Group       *string `json:"group,omitempty"`
	Tag         *string `json:"tag,omitempty"`
	Led         *string `json:"led,omitempty"`
	Frequency   *int64  `json:"frequency,omitempty"`
	Order       *int64  `json:"order,omitempty"`
}

// ImportProblem is a CSV row that could not be read.
type ImportProblem struct {
	Row    int    `json:"row"`
	Reason string `json:"reason"`
}

// Import formats, by the header the file carries.
const (
	FormatSquelch        = "squelch"
	FormatRdioScanner    = "rdio-scanner"
	FormatRadioReference = "radioreference"
)

// MaxImportRows caps a CSV import.
const MaxImportRows = 100_000

type tgColumns struct {
	id, label, name, group, tag, led, frequency, order int
}

// ParseTalkgroupCSV reads a Squelch, rdio-scanner or RadioReference
// talkgroup CSV. A file without a header is read in Squelch column order.
func ParseTalkgroupCSV(r io.Reader) (format string, rows []ImportRow, problems []ImportProblem, err error) {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = -1
	reader.TrimLeadingSpace = true
	reader.LazyQuotes = true
	records, err := reader.ReadAll()
	if err != nil {
		return "", nil, nil, errors.New("the file is not valid CSV")
	}
	if len(records) == 0 {
		return "", nil, nil, errors.New("the file is empty")
	}

	cols := tgColumns{id: 0, label: 1, name: 2, tag: -1, group: -1, led: 6, frequency: 5, order: 7}
	format = FormatSquelch
	start := 0
	first := strings.TrimSpace(records[0][0])
	if first != "" && !unicode.IsDigit(rune(first[0])) {
		cols = tgColumns{id: -1, label: -1, name: -1, group: -1, tag: -1, led: -1, frequency: -1, order: -1}
		start = 1
		for i, raw := range records[0] {
			switch strings.ToLower(strings.TrimSpace(raw)) {
			case "talkgroup_id", "tgid", "talkgroup id", "talkgroupid":
				cols.id = i
			case "dec", "decimal":
				cols.id = i
				format = FormatRadioReference
			case "alpha_tag":
				cols.label = i
				format = FormatRdioScanner
			case "alpha tag", "alphatag", "label":
				cols.label = i
			case "name", "description":
				cols.name = i
			case "group", "service_type", "service type":
				cols.group = i
			case "category":
				cols.group = i
				format = FormatRadioReference
			case "tag":
				cols.tag = i
			case "led", "led_color", "color", "colour":
				cols.led = i
			case "frequency", "freq":
				cols.frequency = i
			case "order", "priority":
				cols.order = i
			}
		}
		if cols.id < 0 {
			return "", nil, nil, errors.New("no talkgroup id column was found (talkgroup_id, dec or decimal)")
		}
	}

	cell := func(rec []string, i int) string {
		if i < 0 || i >= len(rec) {
			return ""
		}
		return strings.TrimSpace(rec[i])
	}
	str := func(rec []string, i int) *string {
		v := cell(rec, i)
		if v == "" {
			return nil
		}
		return &v
	}
	for i := start; i < len(records); i++ {
		rec := records[i]
		rowNum := i + 1
		if len(rec) == 0 || (len(rec) == 1 && strings.TrimSpace(rec[0]) == "") {
			continue
		}
		if len(rows) >= MaxImportRows {
			problems = append(problems, ImportProblem{Row: rowNum, Reason: "the file has more rows than an import takes"})
			break
		}
		idRaw := cell(rec, cols.id)
		if idRaw == "" {
			problems = append(problems, ImportProblem{Row: rowNum, Reason: "talkgroup id is missing"})
			continue
		}
		id, perr := strconv.ParseInt(idRaw, 10, 64)
		if perr != nil || id < 0 {
			problems = append(problems, ImportProblem{Row: rowNum, Reason: "talkgroup id is not a number"})
			continue
		}
		row := ImportRow{Row: rowNum, TalkgroupID: id, Label: str(rec, cols.label), Name: str(rec, cols.name),
			Group: str(rec, cols.group), Tag: str(rec, cols.tag), Led: str(rec, cols.led)}
		if row.Led != nil {
			l := strings.ToLower(*row.Led)
			if !ledColors[l] {
				problems = append(problems, ImportProblem{Row: rowNum, Reason: fmt.Sprintf("led colour %q is not one the scanner shows", *row.Led)})
				continue
			}
			row.Led = &l
		}
		if v := cell(rec, cols.frequency); v != "" {
			f, ferr := strconv.ParseFloat(v, 64)
			if ferr != nil || f < 0 {
				problems = append(problems, ImportProblem{Row: rowNum, Reason: "frequency is not a number"})
				continue
			}
			if f < 10_000 { // MHz in a RadioReference export
				f *= 1_000_000
			}
			hz := int64(f)
			row.Frequency = &hz
		}
		if v := cell(rec, cols.order); v != "" {
			if n, oerr := strconv.ParseInt(v, 10, 64); oerr == nil {
				row.Order = &n
			}
		}
		rows = append(rows, row)
	}
	return format, rows, problems, nil
}

// ImportChange is one field an import would set: what it is now and what
// the file has. Now is empty for a field with no value yet.
type ImportChange struct {
	Field string `json:"field"`
	Now   string `json:"now"`
	After string `json:"after"`
}

// ImportPreviewRow is a parsed row judged against the system.
type ImportPreviewRow struct {
	ImportRow
	// Status is new, unchanged or changed.
	Status  string         `json:"status"`
	Changes []ImportChange `json:"changes"`
}

// TalkgroupImportPreview is what the import wizard's review step shows.
type TalkgroupImportPreview struct {
	Format    string             `json:"format"`
	Rows      []ImportPreviewRow `json:"rows"`
	Problems  []ImportProblem    `json:"problems"`
	New       int                `json:"new"`
	Unchanged int                `json:"unchanged"`
	Changed   int                `json:"changed"`
}

// PreviewTalkgroupImport judges parsed rows against a system's talkgroups.
// Changes list every field that differs, with the current value, so the
// caller can apply them all or only fill blanks.
func PreviewTalkgroupImport(ctx context.Context, q *db.Queries, systemID int64, format string, rows []ImportRow, problems []ImportProblem) (TalkgroupImportPreview, error) {
	existing, err := q.ListTalkgroupsBySystem(ctx, systemID)
	if err != nil {
		return TalkgroupImportPreview{}, fmt.Errorf("failed to list talkgroups: %w", err)
	}
	byID := map[int64]db.Talkgroup{}
	for _, tg := range existing {
		byID[tg.TalkgroupID] = tg
	}
	groups := map[int64]string{}
	if gs, err := q.ListGroups(ctx); err == nil {
		for _, g := range gs {
			groups[g.ID] = g.Label
		}
	}
	tags := map[int64]string{}
	if ts, err := q.ListTags(ctx); err == nil {
		for _, t := range ts {
			tags[t.ID] = t.Label
		}
	}

	out := TalkgroupImportPreview{Format: format, Rows: []ImportPreviewRow{}, Problems: problems}
	if out.Problems == nil {
		out.Problems = []ImportProblem{}
	}
	seen := map[int64]bool{}
	for _, row := range rows {
		if seen[row.TalkgroupID] {
			out.Problems = append(out.Problems, ImportProblem{Row: row.Row, Reason: fmt.Sprintf("talkgroup %d appears more than once; the first row wins", row.TalkgroupID)})
			continue
		}
		seen[row.TalkgroupID] = true
		pr := ImportPreviewRow{ImportRow: row, Changes: []ImportChange{}}
		tg, ok := byID[row.TalkgroupID]
		if !ok {
			pr.Status = "new"
			out.New++
			out.Rows = append(out.Rows, pr)
			continue
		}
		pr.Changes = importChanges(tg, row, groups, tags)
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

func importChanges(tg db.Talkgroup, row ImportRow, groups, tags map[int64]string) []ImportChange {
	out := []ImportChange{}
	add := func(field, now string, after *string) {
		if after == nil || strings.EqualFold(now, *after) {
			return
		}
		out = append(out, ImportChange{Field: field, Now: now, After: *after})
	}
	add("label", tg.Label.String, row.Label)
	add("name", tg.Name.String, row.Name)
	gNow := ""
	if tg.GroupID.Valid {
		gNow = groups[tg.GroupID.Int64]
	}
	add("group", gNow, row.Group)
	tNow := ""
	if tg.TagID.Valid {
		tNow = tags[tg.TagID.Int64]
	}
	add("tag", tNow, row.Tag)
	add("led", tg.Led.String, row.Led)
	if row.Frequency != nil {
		now := ""
		if tg.Frequency.Valid {
			now = strconv.FormatInt(tg.Frequency.Int64, 10)
		}
		after := strconv.FormatInt(*row.Frequency, 10)
		add("frequency", now, &after)
	}
	return out
}

// TalkgroupsImport applies rows from the wizard to a system. Mode "fill"
// sets only fields that are empty today; "overwrite" replaces label, name,
// group, tag, led and frequency with what the file has. New talkgroups are
// always created. Group and tag names that do not exist yet are created.
func (o *Operations) TalkgroupsImport(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		SystemID int64       `json:"systemId"`
		Mode     string      `json:"mode"`
		Rows     []ImportRow `json:"rows"`
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
	for i := range req.Rows {
		if err := checkLed(req.Rows[i].Led); err != nil {
			return nil, UserError(fmt.Sprintf("row %d: %s", req.Rows[i].Row, err.Error()))
		}
	}

	groupIDs := map[string]int64{}
	if gs, err := o.Queries.ListGroups(ctx); err == nil {
		for _, g := range gs {
			groupIDs[strings.ToLower(g.Label)] = g.ID
		}
	}
	tagIDs := map[string]int64{}
	if ts, err := o.Queries.ListTags(ctx); err == nil {
		for _, t := range ts {
			tagIDs[strings.ToLower(t.Label)] = t.ID
		}
	}
	groupFor := func(name *string) (*int64, error) {
		if name == nil {
			return nil, nil
		}
		key := strings.ToLower(strings.TrimSpace(*name))
		if id, ok := groupIDs[key]; ok {
			return &id, nil
		}
		id, err := o.Queries.CreateGroup(ctx, strings.TrimSpace(*name))
		if err != nil {
			return nil, fmt.Errorf("create group %q: %w", *name, err)
		}
		groupIDs[key] = id
		return &id, nil
	}
	tagFor := func(name *string) (*int64, error) {
		if name == nil {
			return nil, nil
		}
		key := strings.ToLower(strings.TrimSpace(*name))
		if id, ok := tagIDs[key]; ok {
			return &id, nil
		}
		id, err := o.Queries.CreateTag(ctx, strings.TrimSpace(*name))
		if err != nil {
			return nil, fmt.Errorf("create tag %q: %w", *name, err)
		}
		tagIDs[key] = id
		return &id, nil
	}

	created, updated, unchanged := 0, 0, 0
	seen := map[int64]bool{}
	for _, row := range req.Rows {
		if seen[row.TalkgroupID] {
			continue
		}
		seen[row.TalkgroupID] = true
		tg, err := o.Queries.GetTalkgroupBySystemAndTGID(ctx, db.GetTalkgroupBySystemAndTGIDParams{SystemID: req.SystemID, TalkgroupID: row.TalkgroupID})
		if err != nil {
			gid, gerr := groupFor(row.Group)
			if gerr != nil {
				return nil, gerr
			}
			tid, terr := tagFor(row.Tag)
			if terr != nil {
				return nil, terr
			}
			var order int64
			if row.Order != nil {
				order = *row.Order
			}
			if _, err := o.Queries.CreateTalkgroup(ctx, db.CreateTalkgroupParams{
				SystemID: req.SystemID, TalkgroupID: row.TalkgroupID,
				Label: ptrToNullStr(trimPtr(row.Label)), Name: ptrToNullStr(trimPtr(row.Name)),
				Frequency: ptrToNullInt(row.Frequency), Led: ptrToNullStr(row.Led),
				GroupID: ptrToNullInt(gid), TagID: ptrToNullInt(tid), Order: order,
			}); err != nil {
				return nil, fmt.Errorf("create talkgroup %d: %w", row.TalkgroupID, err)
			}
			created++
			continue
		}

		next := db.UpdateTalkgroupParams{
			ID: tg.ID, TalkgroupID: tg.TalkgroupID, Label: tg.Label, Name: tg.Name, Frequency: tg.Frequency,
			Led: tg.Led, GroupID: tg.GroupID, TagID: tg.TagID, Order: tg.Order,
		}
		overwrite := req.Mode == "overwrite"
		changed := false
		setStr := func(dst *sql.NullString, v *string) {
			if v == nil || (!overwrite && strings.TrimSpace(dst.String) != "") || dst.String == *v {
				return
			}
			dst.String, dst.Valid, changed = *v, true, true
		}
		setStr(&next.Label, trimPtr(row.Label))
		setStr(&next.Name, trimPtr(row.Name))
		setStr(&next.Led, row.Led)
		if row.Frequency != nil && (overwrite || !next.Frequency.Valid) && next.Frequency.Int64 != *row.Frequency {
			next.Frequency, changed = ptrToNullInt(row.Frequency), true
		}
		if row.Group != nil && (overwrite || !next.GroupID.Valid) {
			gid, gerr := groupFor(row.Group)
			if gerr != nil {
				return nil, gerr
			}
			if !next.GroupID.Valid || next.GroupID.Int64 != *gid {
				next.GroupID, changed = ptrToNullInt(gid), true
			}
		}
		if row.Tag != nil && (overwrite || !next.TagID.Valid) {
			tid, terr := tagFor(row.Tag)
			if terr != nil {
				return nil, terr
			}
			if !next.TagID.Valid || next.TagID.Int64 != *tid {
				next.TagID, changed = ptrToNullInt(tid), true
			}
		}
		if !changed {
			unchanged++
			continue
		}
		if err := o.Queries.UpdateTalkgroup(ctx, next); err != nil {
			return nil, fmt.Errorf("update talkgroup %d: %w", row.TalkgroupID, err)
		}
		updated++
	}

	o.audit(ctx, fmt.Sprintf("admin: talkgroups imported into system %q by %s: %d created, %d updated, %d unchanged (%s)",
		system.Label, o.callerName(ctx, callerID), created, updated, unchanged, req.Mode))
	o.broadcastAdminEvent("talkgroups.updated", nil)
	o.broadcastAdminEvent("groups.updated", nil)
	o.broadcastAdminEvent("tags.updated", nil)
	o.broadcastCFG(ctx)
	return map[string]any{"ok": true, "created": created, "updated": updated, "unchanged": unchanged}, nil
}
