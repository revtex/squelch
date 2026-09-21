package calls

import (
	"database/sql"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/handler/shared"
)

// GetCalls handles GET /api/calls — paginated call archive search.
//
//	@Summary		Search calls
//	@Description	Paginated search of the call archive with optional filters. Authentication is optional when the publicAccess setting is enabled; otherwise a valid JWT is required.
//	@Tags			Calls
//	@Security		BearerAuth
//	@Produce		json
//	@Param			system_ids		query	string	false	"CSV system DB IDs (e.g. 1,2,3)"
//	@Param			talkgroup_ids	query	string	false	"CSV talkgroup DB IDs (e.g. 10,11)"
//	@Param			groups			query	string	false	"CSV group labels (e.g. Police,Fire)"
//	@Param			tags				query	string	false	"CSV tag labels (e.g. Law,EMS)"
//	@Param			system_id		query	int		false	"Legacy single system DB ID"
//	@Param			talkgroup_id	query	int		false	"Legacy single talkgroup DB ID"
//	@Param			group			query	string	false	"Legacy single group label"
//	@Param			tag				query	string	false	"Legacy single tag label"
//	@Param			date_from		query	int		false	"Unix timestamp lower bound"
//	@Param			date_to			query	int		false	"Unix timestamp upper bound"
//	@Param			sort			query	string	false	"Sort order: asc or desc"	Enums(asc, desc)	default(desc)
//	@Param			page			query	int		false	"Page number (1-based)"		default(1)
//	@Param			limit			query	int		false	"Results per page (max 100)"	default(25)
//	@Param			bookmarked_only	query	bool	false	"Show only bookmarked calls"
//	@Param			transcript		query	string	false	"Filter by transcript text (partial match)"
//	@Success		200	{object}	CallSearchResponse	"Paginated call results"
//	@Failure		400	{object}	ErrorResponse		"Invalid query parameter"
//	@Failure		401	{object}	ErrorResponse		"Authentication required (publicAccess disabled)"
//	@Failure		500	{object}	ErrorResponse		"Internal server error"
//	@Router			/calls [get]
//	@Router			/v1/calls [get]
func (h *Handler) GetCalls(c *gin.Context) {
	ctx := c.Request.Context()

	// Anonymous search is allowed only in public-access mode, the same rule
	// as call audio and transcripts.
	if !shared.RequireUserOrPublicAccess(c, h.queries) {
		return
	}

	parseCSVInt64 := func(raw string) ([]int64, error) {
		if strings.TrimSpace(raw) == "" {
			return nil, nil
		}
		parts := strings.Split(raw, ",")
		vals := make([]int64, 0, len(parts))
		seen := make(map[int64]struct{})
		for _, part := range parts {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			n, err := strconv.ParseInt(part, 10, 64)
			if err != nil {
				return nil, err
			}
			if _, ok := seen[n]; ok {
				continue
			}
			seen[n] = struct{}{}
			vals = append(vals, n)
		}
		if len(vals) == 0 {
			return nil, nil
		}
		return vals, nil
	}

	parseCSVStrings := func(raw string) []string {
		if strings.TrimSpace(raw) == "" {
			return nil
		}
		parts := strings.Split(raw, ",")
		vals := make([]string, 0, len(parts))
		seen := make(map[string]struct{})
		for _, part := range parts {
			v := strings.TrimSpace(part)
			if v == "" {
				continue
			}
			if _, ok := seen[v]; ok {
				continue
			}
			seen[v] = struct{}{}
			vals = append(vals, v)
		}
		if len(vals) == 0 {
			return nil
		}
		return vals
	}

	toCSVFilter := func(vals []int64) interface{} {
		if len(vals) == 0 {
			return nil
		}
		parts := make([]string, 0, len(vals))
		for _, v := range vals {
			parts = append(parts, strconv.FormatInt(v, 10))
		}
		return strings.Join(parts, ",")
	}

	// Parse multi-select IDs (new CSV params) with single-select fallback.
	rawSystemIDs := c.Query("system_ids")
	if rawSystemIDs == "" {
		rawSystemIDs = c.Query("system_id")
	}
	rawTalkgroupIDs := c.Query("talkgroup_ids")
	if rawTalkgroupIDs == "" {
		rawTalkgroupIDs = c.Query("talkgroup_id")
	}

	systemIDs, err := parseCSVInt64(rawSystemIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid system_ids"})
		return
	}
	talkgroupIDs, err := parseCSVInt64(rawTalkgroupIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid talkgroup_ids"})
		return
	}

	// Parse multi-select labels (new CSV params) with single-select fallback.
	rawGroups := c.Query("groups")
	if rawGroups == "" {
		rawGroups = c.Query("group")
	}
	rawTags := c.Query("tags")
	if rawTags == "" {
		rawTags = c.Query("tag")
	}
	groupLabels := parseCSVStrings(rawGroups)
	tagLabels := parseCSVStrings(rawTags)

	groupIDs := make([]int64, 0, len(groupLabels))
	for _, label := range groupLabels {
		g, err := h.queries.GetGroupByLabel(ctx, label)
		if err == nil {
			groupIDs = append(groupIDs, g.ID)
		}
	}
	if len(groupLabels) > 0 && len(groupIDs) == 0 {
		c.JSON(http.StatusOK, shared.CallSearchResponse{Calls: []shared.CallSearchResult{}, Total: 0})
		return
	}

	tagIDs := make([]int64, 0, len(tagLabels))
	for _, label := range tagLabels {
		t, err := h.queries.GetTagByLabel(ctx, label)
		if err == nil {
			tagIDs = append(tagIDs, t.ID)
		}
	}
	if len(tagLabels) > 0 && len(tagIDs) == 0 {
		c.JSON(http.StatusOK, shared.CallSearchResponse{Calls: []shared.CallSearchResult{}, Total: 0})
		return
	}

	systemIDsCSV := toCSVFilter(systemIDs)
	talkgroupIDsCSV := toCSVFilter(talkgroupIDs)
	groupIDsCSV := toCSVFilter(groupIDs)
	tagIDsCSV := toCSVFilter(tagIDs)

	var transcript interface{}
	if v := c.Query("transcript"); v != "" {
		transcript = v
	}

	var dateFrom, dateTo interface{}
	if v := c.Query("date_from"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date_from"})
			return
		}
		dateFrom = n
	}
	if v := c.Query("date_to"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date_to"})
			return
		}
		dateTo = n
	}

	page := int64(1)
	if v := c.Query("page"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid page"})
			return
		}
		page = n
	}

	limit := int64(25)
	if v := c.Query("limit"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
			return
		}
		if n > 100 {
			n = 100
		}
		limit = n
	}

	sortOrder := "desc"
	if v := c.Query("sort"); v != "" {
		v = strings.ToLower(v)
		if v != "asc" && v != "desc" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "sort must be asc or desc"})
			return
		}
		sortOrder = v
	}

	offset := (page - 1) * limit

	// Resolve bookmarked_only filter: requires authenticated user.
	var bookmarkUserID interface{}
	if c.Query("bookmarked_only") == "true" {
		if userIDVal, exists := c.Get("userID"); exists {
			if uid, ok := userIDVal.(int64); ok {
				bookmarkUserID = uid
			}
		}
	}

	// Count total matching calls.
	total, err := h.queries.CountCallsFiltered(ctx, db.CountCallsFilteredParams{
		SystemIdsCsv:    systemIDsCSV,
		TalkgroupIdsCsv: talkgroupIDsCSV,
		GroupIdsCsv:     groupIDsCSV,
		TagIdsCsv:       tagIDsCSV,
		DateFrom:        dateFrom,
		DateTo:          dateTo,
		BookmarkUserID:  bookmarkUserID,
		Transcript:      transcript,
	})
	if err != nil {
		slog.Error("failed to count calls", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	// Fetch calls page.
	var calls []db.Call
	listParams := db.ListCallsParams{
		SystemIdsCsv:    systemIDsCSV,
		TalkgroupIdsCsv: talkgroupIDsCSV,
		GroupIdsCsv:     groupIDsCSV,
		TagIdsCsv:       tagIDsCSV,
		DateFrom:        dateFrom,
		DateTo:          dateTo,
		BookmarkUserID:  bookmarkUserID,
		Transcript:      transcript,
		PageOffset:      sql.NullInt64{Int64: offset, Valid: true},
		PageSize:        sql.NullInt64{Int64: limit, Valid: true},
	}
	if sortOrder == "asc" {
		calls, err = h.queries.ListCallsAsc(ctx, db.ListCallsAscParams(listParams))
	} else {
		calls, err = h.queries.ListCalls(ctx, listParams)
	}
	if err != nil {
		slog.Error("failed to list calls", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	// Enforce per-user grants — filter out calls the listener is not
	// authorised to see. Admins and unauthenticated public-access users
	// have nil grants (allow-all).
	grants := shared.LoadUserGrants(c, h.queries)
	if grants != nil {
		allowed := calls[:0]
		for _, call := range calls {
			if shared.IsGranted(grants, call.SystemID, call.TalkgroupID.Int64) {
				allowed = append(allowed, call)
			}
		}
		calls = allowed
		// Adjust total to reflect grant-scoped count. The SQL count does not
		// know about grants, so cap it to the filtered result set size when
		// the filter actually removed rows. This is an approximation; an
		// exact count would require SQL-level grant filtering.
		if int64(len(calls)) < limit {
			total = offset + int64(len(calls))
		}
	}

	// Build set of bookmarked call IDs for authenticated users.
	bookmarkedIDs := make(map[int64]bool)
	if userIDVal, exists := c.Get("userID"); exists {
		if uid, ok := userIDVal.(int64); ok {
			bookmarks, berr := h.queries.ListBookmarksByUser(ctx, sql.NullInt64{Int64: uid, Valid: true})
			if berr == nil {
				for _, bm := range bookmarks {
					bookmarkedIDs[bm.CallID] = true
				}
			}
		}
	}

	// Pre-cache lookups to avoid N+1 queries.
	systemCache := make(map[int64]db.System)
	tgCache := make(map[int64]db.Talkgroup)
	groupCache := make(map[int64]string)
	tagCache := make(map[int64]string)

	// Build response with joined labels and transcripts.
	results := make([]shared.CallSearchResult, 0, len(calls))
	for _, call := range calls {
		r := shared.CallSearchResult{
			ID:        call.ID,
			AudioName: call.AudioName,
			AudioType: call.AudioType,
			DateTime:  call.DateTime,
			SystemID:  call.SystemID,
		}

		if call.Frequency.Valid {
			r.Frequency = &call.Frequency.Int64
		}
		if call.Duration.Valid {
			r.Duration = &call.Duration.Int64
		}
		if call.Source.Valid {
			r.Source = &call.Source.Int64
		}
		if call.ErrorCount.Valid {
			r.ErrorCount = &call.ErrorCount.Int64
		}
		if call.SpikeCount.Valid {
			r.SpikeCount = &call.SpikeCount.Int64
		}
		if call.Site.Valid {
			r.Site = call.Site.String
		}
		if call.Channel.Valid {
			r.Channel = call.Channel.String
		}
		if call.Decoder.Valid {
			r.Decoder = call.Decoder.String
		}
		if call.TalkerAlias.Valid {
			r.TalkerAlias = call.TalkerAlias.String
		}

		// Join system label (cached).
		sys, ok := systemCache[call.SystemID]
		if !ok {
			var serr error
			sys, serr = h.queries.GetSystem(ctx, call.SystemID)
			if serr == nil {
				systemCache[call.SystemID] = sys
			}
		}
		if ok || systemCache[call.SystemID].ID != 0 {
			r.SystemID = sys.SystemID
			r.SystemLabel = sys.Label
		}

		// Join talkgroup details (cached).
		if call.TalkgroupID.Valid {
			tg, ok := tgCache[call.TalkgroupID.Int64]
			if !ok {
				var terr error
				tg, terr = h.queries.GetTalkgroup(ctx, call.TalkgroupID.Int64)
				if terr == nil {
					tgCache[call.TalkgroupID.Int64] = tg
				}
			}
			if ok || tgCache[call.TalkgroupID.Int64].ID != 0 {
				r.TalkgroupID = tg.TalkgroupID
				if tg.Label.Valid {
					r.TalkgroupLabel = tg.Label.String
				}
				if tg.Name.Valid {
					r.TalkgroupName = tg.Name.String
				}
				if tg.Led.Valid {
					r.TalkgroupLed = tg.Led.String
				}
				// Resolve group label (cached).
				if tg.GroupID.Valid {
					grpLabel, ok := groupCache[tg.GroupID.Int64]
					if !ok {
						grp, gerr := h.queries.GetGroup(ctx, tg.GroupID.Int64)
						if gerr == nil {
							groupCache[tg.GroupID.Int64] = grp.Label
							grpLabel = grp.Label
						}
					}
					if ok || grpLabel != "" {
						r.TalkgroupGroup = grpLabel
					}
				}
				// Resolve tag label (cached).
				if tg.TagID.Valid {
					tagLabel, ok := tagCache[tg.TagID.Int64]
					if !ok {
						tag, tgerr := h.queries.GetTag(ctx, tg.TagID.Int64)
						if tgerr == nil {
							tagCache[tg.TagID.Int64] = tag.Label
							tagLabel = tag.Label
						}
					}
					if ok || tagLabel != "" {
						r.TalkgroupTag = tagLabel
					}
				}
			}
		}

		// Join transcript.
		trn, terr := h.queries.GetTranscriptionByCallID(ctx, call.ID)
		if terr == nil {
			r.Transcript = trn.Text
		}

		// Bookmark status.
		r.Bookmarked = bookmarkedIDs[call.ID]

		results = append(results, r)
	}

	c.JSON(http.StatusOK, shared.CallSearchResponse{
		Calls: results,
		Total: total,
	})
}
