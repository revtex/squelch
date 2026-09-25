package calls

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/revtex/squelch/internal/audio"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/downstream"
	"github.com/revtex/squelch/internal/handler/shared"
	"github.com/revtex/squelch/internal/ws"
)

// PostCallUpload handles POST /api/call-upload and /api/trunk-recorder-call-upload.
//
//	@Summary		Upload a call recording
//	@Description	Ingest a radio call with audio and metadata. Requires a valid API key.
//	@Tags			Upload
//	@Accept			multipart/form-data
//	@Produce		json
//	@Security		APIKeyAuth
//	@Param			audio			formData	file	true	"Audio file"
//	@Param			dateTime		formData	int		true	"Unix timestamp of the call"
//	@Param			systemId		formData	int		true	"Radio system ID"
//	@Param			talkgroupId		formData	int		true	"Talkgroup ID"
//	@Param			source			formData	int		false	"Source unit ID"
//	@Param			frequency		formData	int		false	"Frequency in Hz"
//	@Param			duration		formData	number	false	"Call duration in seconds"
//	@Param			talkgroupLabel	formData	string	false	"Talkgroup label for auto-populate"
//	@Param			talkgroupTag	formData	string	false	"Talkgroup tag name"
//	@Param			talkgroupGroup	formData	string	false	"Talkgroup group name"
//	@Param			talkgroupName	formData	string	false	"Talkgroup display name"
//	@Param			systemLabel		formData	string	false	"System label"
//	@Param			patches			formData	string	false	"JSON array of patched talkgroup IDs"
//	@Param			audioName		formData	string	false	"Original audio file name"
//	@Param			audioType		formData	string	false	"Audio MIME type"
//	@Param			site			formData	string	false	"Site identifier"
//	@Param			channel			formData	string	false	"Channel identifier"
//	@Param			decoder			formData	string	false	"Decoder software name"
//	@Param			errorCount		formData	int		false	"Decoding error count"
//	@Param			spikeCount		formData	int		false	"Signal spike count"
//	@Success		200	{object}	object{id=int64}			"Call ingested successfully"
//	@Failure		400	{object}	ErrorResponse			"Bad request"
//	@Failure		401	{object}	ErrorResponse			"API key required"
//	@Failure		403	{object}	ErrorResponse			"API key not permitted for this system"
//	@Failure		429	{object}	ErrorResponse			"Rate limit exceeded"
//	@Failure		500	{object}	ErrorResponse			"Internal server error"
//	@Router			/call-upload [post]
//	@Router			/trunk-recorder-call-upload [post]
func (h *Handler) PostCallUpload(c *gin.Context) {
	slog.Debug("call-upload: request received", "ip", c.ClientIP())
	// Retrieve API key ID injected by APIKeyAuth middleware.
	apiKeyIDVal, exists := c.Get("apiKeyID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "API key required"})
		return
	}
	apiKeyID, ok := apiKeyIDVal.(int64)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	// Per-API-key rate limiting.
	rateLimit := defaultCallRatePerMin
	apiKeyRateOverride := false
	if apiKeyRateVal, ok := c.Get("apiKeyCallRate"); ok {
		if apiKeyRate, ok := apiKeyRateVal.(int64); ok && apiKeyRate > 0 {
			rateLimit = int(apiKeyRate)
			apiKeyRateOverride = true
		}
	}
	if rStr := shared.GetSettingValue(c, h.queries, "apiKeyCallRate"); rStr != "" {
		if r, err := strconv.Atoi(rStr); err == nil && r > 0 && !apiKeyRateOverride {
			rateLimit = r
		}
	}
	if rateLimit > maxCallRatePerMin {
		rateLimit = maxCallRatePerMin
	}
	if !h.getLimiter(apiKeyID, rateLimit).allow() {
		slog.Warn("call upload rate limit exceeded", "api_key_id", apiKeyID)
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "rate limit exceeded"})
		return
	}

	slog.Debug("call-upload: rate limit passed", "api_key_id", apiKeyID)

	// SDRTrunk and other rdio-scanner-compatible clients may send a POST with
	// partial data to verify the API key. rdio-scanner responds with plain-text
	// "Incomplete call data: <reason>" (status 417) which SDRTrunk treats as a
	// successful connection test. We replicate that behavior: parse all fields
	// first, then return the same message format for missing required fields.
	dateTimeStr := c.PostForm("dateTime")
	systemIDStr := c.PostForm("systemId")
	if systemIDStr == "" {
		systemIDStr = c.PostForm("system")
	}
	talkgroupIDStr := c.PostForm("talkgroupId")
	if talkgroupIDStr == "" {
		talkgroupIDStr = c.PostForm("talkgroup")
	}
	_, audioErr := c.FormFile("audio")

	// Check for test=1 explicitly (Trunk Recorder).
	if c.PostForm("test") == "1" {
		c.String(http.StatusOK, "Incomplete call data: no talkgroup\n")
		return
	}

	// rdio-scanner's IsValid() checks all fields WITHOUT early returns and
	// overwrites the error each time, so the LAST failing check wins.
	// SDRTrunk sends system=<id> but no audio/dateTime/talkgroup, so the last
	// error is always "no talkgroup" — which SDRTrunk explicitly checks for.
	// We replicate this behavior: collect the last error, then return it.
	var incompleteReason string
	if audioErr != nil {
		incompleteReason = "no audio"
	}
	if dateTimeStr == "" {
		incompleteReason = "no datetime"
	}
	if systemIDStr == "" {
		incompleteReason = "no system"
	}
	if talkgroupIDStr == "" {
		incompleteReason = "no talkgroup"
	}
	if incompleteReason != "" {
		slog.Warn("call-upload: incomplete data",
			"reason", incompleteReason,
			"api_key_id", apiKeyID,
		)
		c.String(http.StatusExpectationFailed, "Incomplete call data: %s\n", incompleteReason)
		return
	}

	// Parse dateTime.
	// Try unix timestamp first (Trunk Recorder, SDRTrunk), then ISO 8601 (voxcall).
	var dateTimeUnix int64
	if n, err := strconv.ParseInt(dateTimeStr, 10, 64); err == nil {
		dateTimeUnix = n
	} else if t, err := time.Parse(time.RFC3339Nano, dateTimeStr); err == nil {
		dateTimeUnix = t.Unix()
	} else if t, err := time.Parse(time.RFC3339, dateTimeStr); err == nil {
		dateTimeUnix = t.Unix()
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid dateTime: expected unix timestamp or ISO 8601"})
		return
	}
	callTime := time.Unix(dateTimeUnix, 0)

	// Trunk Recorder's rdioscanner_uploader plugin sends "system" and
	// "talkgroup" while our canonical field names are "systemId" and
	// "talkgroupId". Accept both for backward compatibility.
	// (Already parsed above for the connectivity check.)
	systemIDRaw, err := strconv.ParseInt(systemIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid systemId"})
		return
	}

	talkgroupIDRaw, err := strconv.ParseInt(talkgroupIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid talkgroupId"})
		return
	}

	// Parse optional fields.
	var frequency, duration, source sql.NullInt64
	if v := c.PostForm("frequency"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			frequency = sql.NullInt64{Int64: n, Valid: true}
		}
	}
	if v := c.PostForm("duration"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			duration = sql.NullInt64{Int64: n, Valid: true}
		}
	}
	if v := c.PostForm("source"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			source = sql.NullInt64{Int64: n, Valid: true}
		}
	}

	var errorCount, spikeCount sql.NullInt64
	if v := c.PostForm("errorCount"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			errorCount = sql.NullInt64{Int64: n, Valid: true}
		}
	}
	if v := c.PostForm("spikeCount"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			spikeCount = sql.NullInt64{Int64: n, Valid: true}
		}
	}

	var sourcesJSON, frequenciesJSON, patchesJSON sql.NullString
	if v := c.PostForm("sources"); v != "" {
		sourcesJSON = sql.NullString{String: v, Valid: true}
	}
	if v := c.PostForm("frequencies"); v != "" {
		frequenciesJSON = sql.NullString{String: v, Valid: true}
	}
	if v := c.PostForm("patches"); v != "" {
		patchesJSON = sql.NullString{String: v, Valid: true}
	}

	// Trunk-recorder's rdio-scanner uploader embeds unit IDs inside the
	// "sources" JSON array rather than sending a top-level "source" field.
	// Extract the first source unit ID when not explicitly provided.
	if !source.Valid && sourcesJSON.Valid {
		source = extractPrimarySource(sourcesJSON.String)
	}

	// Similarly, error and spike counts are per-segment inside the
	// "frequencies" JSON array. Aggregate them when no top-level values
	// were provided.
	if !errorCount.Valid && !spikeCount.Valid && frequenciesJSON.Valid {
		errorCount, spikeCount = aggregateErrorSpikeCounts(frequenciesJSON.String)
	}

	// Optional call metadata fields.
	var siteCol, channelCol, decoderCol sql.NullString
	if v := c.PostForm("site"); v != "" {
		siteCol = sql.NullString{String: v, Valid: true}
	}
	if v := c.PostForm("channel"); v != "" {
		channelCol = sql.NullString{String: v, Valid: true}
	}
	if v := c.PostForm("decoder"); v != "" {
		decoderCol = sql.NullString{String: v, Valid: true}
	}

	// Optional talkgroup metadata for auto-populate / backfill.
	talkgroupLabel := c.PostForm("talkgroupLabel")
	talkgroupTag := c.PostForm("talkgroupTag")
	talkgroupGroup := c.PostForm("talkgroupGroup")
	talkgroupName := c.PostForm("talkgroupName")

	var talkerAliasCol sql.NullString
	if v := c.PostForm("talkerAlias"); v != "" {
		talkerAliasCol = sql.NullString{String: v, Valid: true}
	}

	// Trunk-recorder embeds OTA aliases in the sources JSON "tag" field
	// rather than sending a top-level "talkerAlias". Extract from the
	// first source entry when not explicitly provided.
	if !talkerAliasCol.Valid && sourcesJSON.Valid {
		talkerAliasCol = extractPrimarySourceTag(sourcesJSON.String)
	}

	ctx := c.Request.Context()
	autoPopulateSystems := shared.GetSettingValue(c, h.queries, "autoPopulateSystems") == "true"

	slog.Debug("call-upload: resolving system and talkgroup",
		"system_id", systemIDRaw, "talkgroup_id", talkgroupIDRaw)

	// Resolve system by its radio system_id.
	system, err := h.queries.GetSystemBySystemID(ctx, systemIDRaw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		slog.Error("failed to query system", "system_id", systemIDRaw, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	if !apiKeyMayUpload(c, err == nil, system.ID) {
		slog.Warn("call-upload: system outside API key scope", "system_id", systemIDRaw)
		c.JSON(http.StatusForbidden, gin.H{"error": "API key not permitted for this system"})
		return
	}
	if err != nil {
		if !autoPopulateSystems {
			c.JSON(http.StatusBadRequest, gin.H{"error": "system not found"})
			return
		}
		label := strconv.FormatInt(systemIDRaw, 10)
		// SDRTrunk and other uploaders send systemLabel with a human-readable name.
		if sl := c.PostForm("systemLabel"); sl != "" {
			label = sl
		}
		newID, cerr := h.queries.CreateSystem(ctx, db.CreateSystemParams{
			SystemID:               systemIDRaw,
			Label:                  label,
			AutoPopulateTalkgroups: 1,
		})
		if cerr != nil {
			slog.Error("failed to auto-create system", "system_id", systemIDRaw, "error", cerr)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}
		slog.Info("auto-populated system", "system_id", systemIDRaw, "label", label, "db_id", newID)
		system = db.System{ID: newID, SystemID: systemIDRaw, Label: label, AutoPopulateTalkgroups: 1}
		h.hub.BroadcastCFG(ctx)
	}

	// Blacklist check: reject calls to blacklisted talkgroups.
	if isBlacklistedTG(system.BlacklistsJson, talkgroupIDRaw) {
		slog.Info("call upload: talkgroup is blacklisted",
			"system_id", systemIDRaw, "talkgroup_id", talkgroupIDRaw)
		c.JSON(http.StatusOK, gin.H{"message": "blacklisted"})
		return
	}

	// Resolve talkgroup by system DB ID + radio talkgroup ID.
	talkgroup, err := h.queries.GetTalkgroupBySystemAndTGID(ctx, db.GetTalkgroupBySystemAndTGIDParams{
		SystemID:    system.ID,
		TalkgroupID: talkgroupIDRaw,
	})
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			slog.Error("failed to query talkgroup", "system_id", system.ID, "talkgroup_id", talkgroupIDRaw, "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}
		if system.AutoPopulateTalkgroups == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "talkgroup not found"})
			return
		}
		var tgLabel, tgName sql.NullString
		if talkgroupLabel != "" {
			tgLabel = sql.NullString{String: talkgroupLabel, Valid: true}
		}
		if talkgroupName != "" {
			tgName = sql.NullString{String: talkgroupName, Valid: true}
		}
		// Resolve group from talkgroupGroup (e.g. SDRTrunk sends this).
		var groupID sql.NullInt64
		if talkgroupGroup != "" {
			groupID = shared.ResolveGroupID(ctx, h.queries, talkgroupGroup)
		}
		// Resolve tag from talkgroupTag (e.g. "Law Dispatch", "Fire-Tac").
		var tagID sql.NullInt64
		if talkgroupTag != "" {
			tagID = shared.ResolveTagID(ctx, h.queries, talkgroupTag)
		}
		newID, cerr := h.queries.CreateTalkgroup(ctx, db.CreateTalkgroupParams{
			SystemID:    system.ID,
			TalkgroupID: talkgroupIDRaw,
			Label:       tgLabel,
			Name:        tgName,
			GroupID:     groupID,
			TagID:       tagID,
		})
		if cerr != nil {
			slog.Error("failed to auto-create talkgroup", "talkgroup_id", talkgroupIDRaw, "error", cerr)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}
		slog.Info("auto-populated talkgroup", "system_id", system.SystemID, "talkgroup_id", talkgroupIDRaw, "label", tgLabel.String, "db_id", newID)
		talkgroup = db.Talkgroup{ID: newID, SystemID: system.ID, TalkgroupID: talkgroupIDRaw, Label: tgLabel, Name: tgName, GroupID: groupID, TagID: tagID}
		h.hub.BroadcastCFG(ctx)
	} else if needsBackfill(talkgroup, talkgroupLabel, talkgroupName, talkgroupTag, talkgroupGroup) {
		// Existing talkgroup has empty fields — backfill from upload metadata.
		if !talkgroup.Label.Valid && talkgroupLabel != "" {
			talkgroup.Label = sql.NullString{String: talkgroupLabel, Valid: true}
		}
		if !talkgroup.Name.Valid && talkgroupName != "" {
			talkgroup.Name = sql.NullString{String: talkgroupName, Valid: true}
		}
		if !talkgroup.GroupID.Valid && talkgroupGroup != "" {
			talkgroup.GroupID = shared.ResolveGroupID(ctx, h.queries, talkgroupGroup)
		}
		if !talkgroup.TagID.Valid && talkgroupTag != "" {
			talkgroup.TagID = shared.ResolveTagID(ctx, h.queries, talkgroupTag)
		}
		if uerr := h.queries.UpdateTalkgroup(ctx, db.UpdateTalkgroupParams{
			ID:          talkgroup.ID,
			TalkgroupID: talkgroup.TalkgroupID,
			Label:       talkgroup.Label,
			Name:        talkgroup.Name,
			Frequency:   talkgroup.Frequency,
			Led:         talkgroup.Led,
			GroupID:     talkgroup.GroupID,
			TagID:       talkgroup.TagID,
			Order:       talkgroup.Order,
		}); uerr != nil {
			slog.Warn("failed to backfill talkgroup from upload",
				"talkgroup_id", talkgroup.TalkgroupID, "error", uerr)
		} else {
			slog.Info("backfilled talkgroup from upload",
				"talkgroup_id", talkgroup.TalkgroupID)
			h.hub.BroadcastCFG(ctx)
		}
	}

	// Duplicate detection (system.ID and talkgroup.ID are the FK values in calls).
	if shared.GetSettingValue(c, h.queries, "disableDuplicateDetection") != "true" {
		windowMs := int64(2000)
		if v := shared.GetSettingValue(c, h.queries, "duplicateDetectionTimeFrame"); v != "" {
			if wm, err := strconv.ParseInt(v, 10, 64); err == nil {
				windowMs = wm
			}
		}
		dup, derr := audio.IsDuplicate(ctx, h.queries, system.ID, talkgroup.ID, callTime, windowMs)
		if derr != nil {
			slog.Error("duplicate detection failed", "error", derr)
			// Non-fatal: proceed with ingest.
		} else if dup {
			slog.Info("duplicate call rejected", "system_id", systemIDRaw, "talkgroup_id", talkgroupIDRaw)
			c.JSON(http.StatusOK, gin.H{"message": "duplicate call rejected"})
			return
		}
	}

	// Get uploaded audio file.
	fh, err := c.FormFile("audio")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "audio file is required"})
		return
	}

	// Resolve audio conversion mode from settings.
	convMode := audio.ConversionDisabled
	if mStr := shared.GetSettingValue(c, h.queries, "audioConversion"); mStr != "" {
		if m, err := strconv.Atoi(mStr); err == nil {
			convMode = audio.ConversionMode(m)
		}
	}

	// Resolve encoding preset from settings.
	convPreset := audio.ParseEncodingPreset(shared.GetSettingValue(c, h.queries, "audioEncodingPreset"))

	// Store audio file (conversion handled inside Processor.Store).
	relPath, err := h.processor.Store(ctx, fh, convMode, convPreset)
	if err != nil {
		slog.Error("failed to store audio file",
			"system_id", systemIDRaw,
			"talkgroup_id", talkgroupIDRaw,
			"error", err,
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store audio"})
		return
	}

	slog.Debug("call-upload: audio stored", "path", relPath, "mode", convMode)

	// If the recorder didn't supply a duration, probe the stored file.
	if !duration.Valid {
		absPath := filepath.Join(h.processor.RecordingsDir(), relPath)
		if d := audio.ProbeDuration(ctx, absPath); d > 0 {
			duration = sql.NullInt64{Int64: d, Valid: true}
		}
	}

	// Determine audio MIME type.
	// When conversion is enabled the output format depends on the encoding
	// preset (M4A for AAC presets, MP3 for MP3 presets).
	// Otherwise validate the client-supplied Content-Type against an allowlist
	// to prevent attacker-controlled MIME types from reaching the database.
	var audioType string
	if convMode != audio.ConversionDisabled {
		audioType = audio.OutputMIME(convPreset)
	} else {
		switch fh.Header.Get("Content-Type") {
		case "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav",
			"audio/ogg", "audio/aac", "audio/m4a", "audio/mp4",
			"audio/x-m4a", "audio/opus":
			audioType = fh.Header.Get("Content-Type")
		default:
			audioType = "application/octet-stream"
		}
	}

	// Insert call record.
	callID, err := h.queries.CreateCall(ctx, db.CreateCallParams{
		AudioPath:       relPath,
		AudioName:       filepath.Base(relPath),
		AudioType:       audioType,
		DateTime:        dateTimeUnix,
		Frequency:       frequency,
		Duration:        duration,
		Source:          source,
		SourcesJson:     sourcesJSON,
		FrequenciesJson: frequenciesJSON,
		PatchesJson:     patchesJSON,
		SystemID:        system.ID,
		TalkgroupID:     sql.NullInt64{Int64: talkgroup.ID, Valid: true},
		Site:            siteCol,
		Channel:         channelCol,
		Decoder:         decoderCol,
		ErrorCount:      errorCount,
		SpikeCount:      spikeCount,
		TalkerAlias:     talkerAliasCol,
		ApiKeyID:        sql.NullInt64{Int64: apiKeyID, Valid: true},
	})
	if err != nil {
		slog.Error("failed to insert call", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	slog.Debug("call-upload: db record inserted",
		"call_id", callID,
		"system_id", systemIDRaw,
		"talkgroup_id", talkgroupIDRaw,
		"audio_path", relPath,
	)

	// Extract unit tags from sources JSON and upsert into units table.
	// Sources format: [{"pos":0,"src":12345,"tag":"Unit Name"}, ...]
	if sourcesJSON.Valid {
		upsertUnitsFromSources(ctx, h.queries, system.ID, sourcesJSON.String)
	}

	// Map talkerAlias to the source unit as a label (e.g. P25 radios broadcasting a name).
	if source.Valid && talkerAliasCol.Valid {
		if err := h.queries.UpsertUnit(ctx, db.UpsertUnitParams{
			SystemID: system.ID,
			UnitID:   source.Int64,
			Label:    sql.NullString{String: talkerAliasCol.String, Valid: true},
		}); err != nil {
			slog.Warn("failed to upsert unit from talkerAlias",
				"unit_id", source.Int64, "talkerAlias", talkerAliasCol.String, "error", err)
		}
	}

	// Broadcast to WebSocket listeners.
	if h.hub != nil {
		calPayload := map[string]any{
			"id":          callID,
			"audioName":   filepath.Base(relPath),
			"audioType":   audioType,
			"dateTime":    dateTimeUnix,
			"systemId":    system.SystemID,
			"system":      system.ID,
			"talkgroupId": talkgroup.TalkgroupID,
			"talkgroup":   talkgroup.ID,
		}
		if frequency.Valid {
			calPayload["frequency"] = frequency.Int64
		}
		if duration.Valid {
			calPayload["duration"] = duration.Int64
		}
		if source.Valid {
			calPayload["source"] = source.Int64
		}
		if siteCol.Valid {
			calPayload["site"] = siteCol.String
		}
		if channelCol.Valid {
			calPayload["channel"] = channelCol.String
		}
		if decoderCol.Valid {
			calPayload["decoder"] = decoderCol.String
		}
		if errorCount.Valid {
			calPayload["errorCount"] = errorCount.Int64
		}
		if spikeCount.Valid {
			calPayload["spikeCount"] = spikeCount.Int64
		}
		if talkerAliasCol.Valid {
			calPayload["talkerAlias"] = talkerAliasCol.String
		}
		if sourcesJSON.Valid {
			calPayload["sources"] = sourcesJSON.String
		}
		if frequenciesJSON.Valid {
			calPayload["frequencies"] = frequenciesJSON.String
		}
		calMsg, err := ws.NewCALMessage(calPayload)
		if err != nil {
			slog.Error("failed to build CAL message", "error", err)
		} else {
			_ = calMsg
			h.hub.BroadcastCAL(calPayload, func(cl *ws.Client) bool {
				return cl.CanReceive(system.ID, talkgroup.ID)
			})
			slog.Debug("call-upload: ws broadcast sent", "call_id", callID)
		}
	}

	logAttrs := []any{
		"call_id", callID,
		"system_id", systemIDRaw,
		"talkgroup_id", talkgroupIDRaw,
		"audio_path", relPath,
		"api_key_id", apiKeyID,
	}
	if duration.Valid {
		logAttrs = append(logAttrs, "duration_ms", duration.Int64)
	}
	slog.Info("call-upload: complete", logAttrs...)

	c.JSON(http.StatusOK, gin.H{"id": callID, "message": "Call imported successfully."})

	// Notify downstream pushers (non-blocking, after response is sent).
	if h.dsNotifier != nil {
		// Resolve labels for downstream consumers.
		var groupLabel, tagLabel string
		if talkgroup.GroupID.Valid {
			if g, err := h.queries.GetGroup(ctx, talkgroup.GroupID.Int64); err == nil {
				groupLabel = g.Label
			}
		}
		if talkgroup.TagID.Valid {
			if t, err := h.queries.GetTag(ctx, talkgroup.TagID.Int64); err == nil {
				tagLabel = t.Label
			}
		}

		h.dsNotifier.Notify(downstream.CallEvent{
			CallID:         callID,
			AudioPath:      relPath,
			AudioName:      filepath.Base(relPath),
			AudioType:      audioType,
			DateTime:       dateTimeUnix,
			SystemID:       system.SystemID,
			System:         system.ID,
			TalkgroupID:    talkgroup.TalkgroupID,
			Talkgroup:      talkgroup.ID,
			Frequency:      frequency.Int64,
			Duration:       duration.Int64,
			Source:         source.Int64,
			Sources:        sourcesJSON.String,
			Frequencies:    frequenciesJSON.String,
			Patches:        patchesJSON.String,
			SystemLabel:    system.Label,
			TalkgroupLabel: talkgroup.Label.String,
			TalkgroupName:  talkgroup.Name.String,
			TalkgroupGroup: groupLabel,
			TalkgroupTag:   tagLabel,
			TalkerAlias:    talkerAliasCol.String,
		})
		slog.Debug("call-upload: downstream notify queued", "call_id", callID)
	}

	// Enqueue transcription (non-blocking, after response is sent).
	if h.transcriber != nil {
		absPath := filepath.Join(h.processor.RecordingsDir(), relPath)
		if err := h.transcriber.Submit(ctx, audio.TranscriptionJob{
			CallID:     callID,
			AudioPath:  absPath,
			DurationMs: duration.Int64,
		}); err != nil {
			slog.Warn("call-upload: failed to enqueue transcription", "call_id", callID, "error", err)
		}
	}
}

// --- helpers ---

// needsBackfill returns true if at least one talkgroup field is empty and a
// corresponding value was provided in the upload metadata.
func needsBackfill(tg db.Talkgroup, label, name, tag, group string) bool {
	if !tg.Label.Valid && label != "" {
		return true
	}
	if !tg.Name.Valid && name != "" {
		return true
	}
	if !tg.TagID.Valid && tag != "" {
		return true
	}
	if !tg.GroupID.Valid && group != "" {
		return true
	}
	return false
}

// isBlacklistedTG checks whether a talkgroup ID appears in a system's blacklist.
// The blacklist is a JSON array of integers stored in blacklists_json.
func isBlacklistedTG(blacklistsJSON sql.NullString, talkgroupID int64) bool {
	if !blacklistsJSON.Valid || strings.TrimSpace(blacklistsJSON.String) == "" {
		return false
	}
	var ids []int64
	if err := json.Unmarshal([]byte(blacklistsJSON.String), &ids); err != nil {
		slog.Warn("failed to parse blacklists_json", "error", err)
		return false
	}
	for _, id := range ids {
		if id == talkgroupID {
			return true
		}
	}
	return false
}

// upsertUnitsFromSources parses the sources JSON array and upserts any units
// that include a "tag" (label) into the units table.
// Sources format: [{"pos":0,"src":12345,"tag":"Unit Name"}, ...]
// Entries without "src" or "tag" are silently skipped.
func upsertUnitsFromSources(ctx context.Context, q *db.Queries, systemDBID int64, raw string) {
	var sources []map[string]any
	if err := json.Unmarshal([]byte(raw), &sources); err != nil {
		return
	}
	for _, entry := range sources {
		srcVal, ok := entry["src"]
		if !ok {
			continue
		}
		srcFloat, ok := srcVal.(float64)
		if !ok || srcFloat <= 0 {
			continue
		}
		tagVal, ok := entry["tag"]
		if !ok {
			continue
		}
		tag, ok := tagVal.(string)
		if !ok || tag == "" {
			continue
		}
		if err := q.UpsertUnit(ctx, db.UpsertUnitParams{
			SystemID: systemDBID,
			UnitID:   int64(srcFloat),
			Label:    sql.NullString{String: tag, Valid: true},
		}); err != nil {
			slog.Warn("failed to upsert unit from sources",
				"unit_id", int64(srcFloat), "tag", tag, "error", err)
		}
	}
}

// extractPrimarySource returns the "src" value from the first entry in a
// sources JSON array. Trunk-recorder sends unit IDs only inside this array
// (e.g. [{"pos":0,"src":12345}, ...]) and does not set a top-level "source".
func extractPrimarySource(raw string) sql.NullInt64 {
	var sources []map[string]any
	if err := json.Unmarshal([]byte(raw), &sources); err != nil || len(sources) == 0 {
		return sql.NullInt64{}
	}
	srcVal, ok := sources[0]["src"]
	if !ok {
		return sql.NullInt64{}
	}
	srcFloat, ok := srcVal.(float64)
	if !ok || srcFloat <= 0 {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: int64(srcFloat), Valid: true}
}

// extractPrimarySourceTag returns the "tag" value from the first source entry
// that has a non-empty tag. Trunk-recorder sends OTA aliases (talker alias)
// inside the sources JSON rather than as a top-level "talkerAlias" field.
func extractPrimarySourceTag(raw string) sql.NullString {
	var sources []map[string]any
	if err := json.Unmarshal([]byte(raw), &sources); err != nil {
		return sql.NullString{}
	}
	for _, entry := range sources {
		tagVal, ok := entry["tag"]
		if !ok {
			continue
		}
		tag, ok := tagVal.(string)
		if !ok || tag == "" {
			continue
		}
		return sql.NullString{String: tag, Valid: true}
	}
	return sql.NullString{}
}

// aggregateErrorSpikeCounts sums errorCount and spikeCount from all entries
// in a frequencies JSON array. Trunk-recorder sends per-segment values inside
// this array (e.g. [{"errorCount":2,"spikeCount":0}, ...]) rather than
// providing aggregate top-level fields.
func aggregateErrorSpikeCounts(raw string) (sql.NullInt64, sql.NullInt64) {
	var freqs []map[string]any
	if err := json.Unmarshal([]byte(raw), &freqs); err != nil || len(freqs) == 0 {
		return sql.NullInt64{}, sql.NullInt64{}
	}
	var totalErrors, totalSpikes int64
	var found bool
	for _, entry := range freqs {
		if v, ok := entry["errorCount"]; ok {
			if f, ok := v.(float64); ok {
				totalErrors += int64(f)
				found = true
			}
		}
		// trunk-recorder also uses "error_count" in its call JSON.
		if v, ok := entry["error_count"]; ok {
			if f, ok := v.(float64); ok {
				totalErrors += int64(f)
				found = true
			}
		}
		if v, ok := entry["spikeCount"]; ok {
			if f, ok := v.(float64); ok {
				totalSpikes += int64(f)
				found = true
			}
		}
		if v, ok := entry["spike_count"]; ok {
			if f, ok := v.(float64); ok {
				totalSpikes += int64(f)
				found = true
			}
		}
	}
	if !found {
		return sql.NullInt64{}, sql.NullInt64{}
	}
	return sql.NullInt64{Int64: totalErrors, Valid: true},
		sql.NullInt64{Int64: totalSpikes, Valid: true}
}

// apiKeyMayUpload reports whether the authenticated API key may upload to a
// system. Unscoped keys may upload anywhere; a scoped key may upload only to
// an existing system in its scope, so it can never auto-create one.
func apiKeyMayUpload(c *gin.Context, systemExists bool, systemDBID int64) bool {
	v, scoped := c.Get(auth.APIKeySystemsContextKey)
	if !scoped {
		return true
	}
	grants, _ := v.([]auth.SystemGrant)
	if grants == nil {
		grants = auth.DenyAllGrants()
	}
	return systemExists && auth.GrantsIncludeSystem(grants, systemDBID)
}
