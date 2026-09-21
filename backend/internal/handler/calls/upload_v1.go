// Phase N-1 — native /api/v1/calls upload handler.
//
// Differs from the legacy /api/call-upload handler in three ways:
//
//  1. Multipart field names are the canonical native set per
//     docs/plans/native-api-design-plan.md §5: systemId, talkgroupId,
//     startedAt, frequencyHz, durationMs, unitId, talkerAlias, etc.
//     The legacy aliases (system, talkgroup, dateTime, frequency, duration,
//     source) are NOT accepted on v1.
//
//  2. startedAt MUST be RFC 3339; unix-timestamp values are rejected with
//     a 400 validation_failed envelope.
//
//  3. All 4xx/5xx responses use the v1 error envelope (shared.WriteAPIError).
//     The form-field `key=` auth transport is not honoured (Bearer only —
//     enforced by APIKeyAuth + V1Marker).
//
// The post-validation ingest pipeline (system/talkgroup resolve, blacklist
// check, duplicate detection, audio store, DB insert, WS broadcast,
// downstream notify, transcription enqueue) is intentionally kept structurally
// equivalent to the legacy handler so a future refactor can extract a shared
// core without behavioural drift between the two paths.
package calls

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/revtex/squelch/internal/audio"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/downstream"
	"github.com/revtex/squelch/internal/handler/shared"
	"github.com/revtex/squelch/internal/ws"
)

// PostCallUploadV1 handles POST /api/v1/calls — the native upload endpoint.
//
//	@Summary		Upload a call recording (native v1)
//	@Description	Ingest a radio call with audio and metadata using the native field names. Requires Authorization: Bearer <api-key>. The startedAt field must be RFC 3339; unix timestamps are rejected.
//	@Tags			v1-Calls
//	@Accept			multipart/form-data
//	@Produce		json
//	@Security		BearerAPIKey
//	@Param			audio			formData	file	true	"Audio file"
//	@Param			startedAt		formData	string	true	"RFC 3339 start timestamp"
//	@Param			systemId		formData	int		true	"Radio system ID"
//	@Param			talkgroupId		formData	int		true	"Talkgroup ID"
//	@Param			unitId			formData	int		false	"Source unit ID"
//	@Param			frequencyHz		formData	int		false	"Frequency in Hz"
//	@Param			durationMs		formData	int		false	"Call duration in milliseconds"
//	@Param			talkgroupLabel	formData	string	false	"Talkgroup label"
//	@Param			talkgroupTag	formData	string	false	"Talkgroup tag name"
//	@Param			talkgroupGroup	formData	string	false	"Talkgroup group name"
//	@Param			talkgroupName	formData	string	false	"Talkgroup display name"
//	@Param			systemLabel		formData	string	false	"System label"
//	@Param			talkerAlias		formData	string	false	"OTA talker alias"
//	@Param			site			formData	string	false	"Site identifier"
//	@Param			channel			formData	string	false	"Channel identifier"
//	@Param			decoder			formData	string	false	"Decoder software name"
//	@Param			errorCount		formData	int		false	"Decoding error count"
//	@Param			spikeCount		formData	int		false	"Signal spike count"
//	@Param			sources			formData	string	false	"JSON array of per-segment source units"
//	@Param			frequencies		formData	string	false	"JSON array of per-segment frequencies"
//	@Param			patches			formData	string	false	"JSON array of patched talkgroup IDs"
//	@Success		200	{object}	object{id=int64,message=string}	"Call ingested"
//	@Failure		400	{object}	shared.APIErrorResponse	"Validation failed"
//	@Failure		401	{object}	shared.APIErrorResponse	"Invalid credentials"
//	@Failure		403	{object}	shared.APIErrorResponse	"API key not permitted for this system"
//	@Failure		422	{object}	shared.APIErrorResponse	"Unprocessable entity (system/talkgroup not configured)"
//	@Failure		429	{object}	shared.APIErrorResponse	"Rate limit exceeded"
//	@Failure		500	{object}	shared.APIErrorResponse	"Internal error"
//	@Router			/v1/calls [post]
func (h *Handler) PostCallUploadV1(c *gin.Context) {
	apiKeyIDVal, exists := c.Get("apiKeyID")
	if !exists {
		shared.WriteAPIError(c, http.StatusUnauthorized, shared.CodeInvalidCredentials, "API key required", nil)
		return
	}
	apiKeyID, ok := apiKeyIDVal.(int64)
	if !ok {
		shared.WriteAPIError(c, http.StatusInternalServerError, shared.CodeInternalError, "internal error", nil)
		return
	}

	// Per-API-key rate limiting (mirrors the legacy handler).
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
		slog.Warn("v1 call upload rate limit exceeded", "api_key_id", apiKeyID)
		shared.WriteAPIError(c, http.StatusTooManyRequests, shared.CodeRateLimited,
			"rate limit exceeded", map[string]any{"retryAfterSeconds": 60})
		return
	}

	// Parse and validate native multipart fields.
	startedAt := c.PostForm("startedAt")
	if startedAt == "" {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed,
			"startedAt is required", map[string]any{"field": "startedAt"})
		return
	}
	// Native rejects unix timestamps explicitly: a value that parses as a
	// pure int64 is reported back so the recorder operator can fix their
	// integration before silently sending bad data.
	if _, intErr := strconv.ParseInt(startedAt, 10, 64); intErr == nil {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed,
			"startedAt must be an RFC 3339 timestamp",
			map[string]any{"field": "startedAt", "got": startedAt})
		return
	}
	var callTime time.Time
	if t, err := time.Parse(time.RFC3339Nano, startedAt); err == nil {
		callTime = t
	} else if t, err := time.Parse(time.RFC3339, startedAt); err == nil {
		callTime = t
	} else {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed,
			"startedAt must be an RFC 3339 timestamp",
			map[string]any{"field": "startedAt", "got": startedAt})
		return
	}
	dateTimeUnix := callTime.Unix()

	systemIDStr := c.PostForm("systemId")
	if systemIDStr == "" {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed,
			"systemId is required", map[string]any{"field": "systemId"})
		return
	}
	systemIDRaw, err := strconv.ParseInt(systemIDStr, 10, 64)
	if err != nil {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed,
			"systemId must be an integer", map[string]any{"field": "systemId"})
		return
	}

	talkgroupIDStr := c.PostForm("talkgroupId")
	if talkgroupIDStr == "" {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed,
			"talkgroupId is required", map[string]any{"field": "talkgroupId"})
		return
	}
	talkgroupIDRaw, err := strconv.ParseInt(talkgroupIDStr, 10, 64)
	if err != nil {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed,
			"talkgroupId must be an integer", map[string]any{"field": "talkgroupId"})
		return
	}

	fh, err := c.FormFile("audio")
	if err != nil {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed,
			"audio file is required", map[string]any{"field": "audio"})
		return
	}

	// Optional native fields.
	var frequency, duration, source sql.NullInt64
	if v := c.PostForm("frequencyHz"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			frequency = sql.NullInt64{Int64: n, Valid: true}
		}
	}
	if v := c.PostForm("durationMs"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			duration = sql.NullInt64{Int64: n, Valid: true}
		}
	}
	if v := c.PostForm("unitId"); v != "" {
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
	if !source.Valid && sourcesJSON.Valid {
		source = extractPrimarySource(sourcesJSON.String)
	}
	if !errorCount.Valid && !spikeCount.Valid && frequenciesJSON.Valid {
		errorCount, spikeCount = aggregateErrorSpikeCounts(frequenciesJSON.String)
	}

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

	talkgroupLabel := c.PostForm("talkgroupLabel")
	talkgroupTag := c.PostForm("talkgroupTag")
	talkgroupGroup := c.PostForm("talkgroupGroup")
	talkgroupName := c.PostForm("talkgroupName")

	var talkerAliasCol sql.NullString
	if v := c.PostForm("talkerAlias"); v != "" {
		talkerAliasCol = sql.NullString{String: v, Valid: true}
	}
	if !talkerAliasCol.Valid && sourcesJSON.Valid {
		talkerAliasCol = extractPrimarySourceTag(sourcesJSON.String)
	}

	ctx := c.Request.Context()
	autoPopulateSystems := shared.GetSettingValue(c, h.queries, "autoPopulateSystems") == "true"

	// Resolve system.
	system, err := h.queries.GetSystemBySystemID(ctx, systemIDRaw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		slog.Error("v1 upload: failed to query system", "system_id", systemIDRaw, "error", err)
		shared.WriteAPIError(c, http.StatusInternalServerError, shared.CodeInternalError, "internal error", nil)
		return
	}
	if !apiKeyMayUpload(c, err == nil, system.ID) {
		slog.Warn("v1 upload: system outside API key scope", "system_id", systemIDRaw)
		shared.WriteAPIError(c, http.StatusForbidden, shared.CodeForbidden,
			"API key not permitted for this system", map[string]any{"systemId": systemIDRaw})
		return
	}
	if err != nil {
		if !autoPopulateSystems {
			shared.WriteAPIError(c, http.StatusUnprocessableEntity, shared.CodeSystemNotFound,
				"system is not configured and autoPopulateSystems is disabled",
				map[string]any{"systemId": systemIDRaw})
			return
		}
		label := strconv.FormatInt(systemIDRaw, 10)
		if sl := c.PostForm("systemLabel"); sl != "" {
			label = sl
		}
		newID, cerr := h.queries.CreateSystem(ctx, db.CreateSystemParams{
			SystemID:               systemIDRaw,
			Label:                  label,
			AutoPopulateTalkgroups: 1,
		})
		if cerr != nil {
			slog.Error("v1 upload: failed to auto-create system", "system_id", systemIDRaw, "error", cerr)
			shared.WriteAPIError(c, http.StatusInternalServerError, shared.CodeInternalError, "internal error", nil)
			return
		}
		slog.Info("v1 upload: auto-populated system", "system_id", systemIDRaw, "label", label, "db_id", newID)
		system = db.System{ID: newID, SystemID: systemIDRaw, Label: label, AutoPopulateTalkgroups: 1}
		h.hub.BroadcastCFG(ctx)
	}

	// Blacklist check — same observable behaviour as legacy (200 with a hint).
	if isBlacklistedTG(system.BlacklistsJson, talkgroupIDRaw) {
		slog.Info("v1 upload: talkgroup blacklisted",
			"system_id", systemIDRaw, "talkgroup_id", talkgroupIDRaw)
		c.JSON(http.StatusOK, gin.H{"status": "blacklisted"})
		return
	}

	// Resolve talkgroup.
	talkgroup, err := h.queries.GetTalkgroupBySystemAndTGID(ctx, db.GetTalkgroupBySystemAndTGIDParams{
		SystemID:    system.ID,
		TalkgroupID: talkgroupIDRaw,
	})
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			slog.Error("v1 upload: failed to query talkgroup",
				"system_id", system.ID, "talkgroup_id", talkgroupIDRaw, "error", err)
			shared.WriteAPIError(c, http.StatusInternalServerError, shared.CodeInternalError, "internal error", nil)
			return
		}
		if system.AutoPopulateTalkgroups == 0 {
			shared.WriteAPIError(c, http.StatusUnprocessableEntity, shared.CodeTalkgroupNotFound,
				"talkgroup is not configured for this system",
				map[string]any{"systemId": systemIDRaw, "talkgroupId": talkgroupIDRaw})
			return
		}
		var tgLabel, tgName sql.NullString
		if talkgroupLabel != "" {
			tgLabel = sql.NullString{String: talkgroupLabel, Valid: true}
		}
		if talkgroupName != "" {
			tgName = sql.NullString{String: talkgroupName, Valid: true}
		}
		var groupID sql.NullInt64
		if talkgroupGroup != "" {
			groupID = shared.ResolveGroupID(ctx, h.queries, talkgroupGroup)
		}
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
			slog.Error("v1 upload: failed to auto-create talkgroup",
				"talkgroup_id", talkgroupIDRaw, "error", cerr)
			shared.WriteAPIError(c, http.StatusInternalServerError, shared.CodeInternalError, "internal error", nil)
			return
		}
		slog.Info("v1 upload: auto-populated talkgroup",
			"system_id", system.SystemID, "talkgroup_id", talkgroupIDRaw, "label", tgLabel.String, "db_id", newID)
		talkgroup = db.Talkgroup{ID: newID, SystemID: system.ID, TalkgroupID: talkgroupIDRaw, Label: tgLabel, Name: tgName, GroupID: groupID, TagID: tagID}
		h.hub.BroadcastCFG(ctx)
	} else if needsBackfill(talkgroup, talkgroupLabel, talkgroupName, talkgroupTag, talkgroupGroup) {
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
			slog.Warn("v1 upload: failed to backfill talkgroup",
				"talkgroup_id", talkgroup.TalkgroupID, "error", uerr)
		} else {
			h.hub.BroadcastCFG(ctx)
		}
	}

	// Duplicate detection — same window + same observable response shape as
	// the legacy handler, but signalled via 409 to match the v1 contract.
	if shared.GetSettingValue(c, h.queries, "disableDuplicateDetection") != "true" {
		windowMs := int64(2000)
		if v := shared.GetSettingValue(c, h.queries, "duplicateDetectionTimeFrame"); v != "" {
			if wm, err := strconv.ParseInt(v, 10, 64); err == nil {
				windowMs = wm
			}
		}
		dup, derr := audio.IsDuplicate(ctx, h.queries, system.ID, talkgroup.ID, callTime, windowMs)
		if derr != nil {
			slog.Error("v1 upload: duplicate detection failed", "error", derr)
		} else if dup {
			slog.Info("v1 upload: duplicate rejected",
				"system_id", systemIDRaw, "talkgroup_id", talkgroupIDRaw)
			shared.WriteAPIError(c, http.StatusConflict, shared.CodeDuplicateCall,
				"a call with the same system, talkgroup, and startedAt already exists",
				map[string]any{"systemId": systemIDRaw, "talkgroupId": talkgroupIDRaw})
			return
		}
	}

	// Audio storage.
	convMode := audio.ConversionDisabled
	if mStr := shared.GetSettingValue(c, h.queries, "audioConversion"); mStr != "" {
		if m, err := strconv.Atoi(mStr); err == nil {
			convMode = audio.ConversionMode(m)
		}
	}
	convPreset := audio.ParseEncodingPreset(shared.GetSettingValue(c, h.queries, "audioEncodingPreset"))

	relPath, err := h.processor.Store(ctx, fh, convMode, convPreset)
	if err != nil {
		slog.Error("v1 upload: failed to store audio",
			"system_id", systemIDRaw, "talkgroup_id", talkgroupIDRaw, "error", err)
		shared.WriteAPIError(c, http.StatusInternalServerError, shared.CodeInternalError, "failed to store audio", nil)
		return
	}

	if !duration.Valid {
		absPath := filepath.Join(h.processor.RecordingsDir(), relPath)
		if d := audio.ProbeDuration(ctx, absPath); d > 0 {
			duration = sql.NullInt64{Int64: d, Valid: true}
		}
	}

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
	})
	if err != nil {
		slog.Error("v1 upload: failed to insert call", "error", err)
		shared.WriteAPIError(c, http.StatusInternalServerError, shared.CodeInternalError, "internal error", nil)
		return
	}

	if sourcesJSON.Valid {
		upsertUnitsFromSources(ctx, h.queries, system.ID, sourcesJSON.String)
	}
	if source.Valid && talkerAliasCol.Valid {
		if err := h.queries.UpsertUnit(ctx, db.UpsertUnitParams{
			SystemID: system.ID,
			UnitID:   source.Int64,
			Label:    sql.NullString{String: talkerAliasCol.String, Valid: true},
		}); err != nil {
			slog.Warn("v1 upload: failed to upsert unit from talkerAlias",
				"unit_id", source.Int64, "error", err)
		}
	}

	// Broadcast over the legacy CAL channel — Phase N-2 will introduce the
	// native call.new JSON-object shape on /api/v1/ws/listener.
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
		if calMsg, err := ws.NewCALMessage(calPayload); err == nil {
			_ = calMsg
			h.hub.BroadcastCAL(calPayload, func(cl *ws.Client) bool {
				return cl.CanReceive(system.ID, talkgroup.ID)
			})
		} else {
			slog.Error("v1 upload: build CAL message failed", "error", err)
		}
	}

	slog.Info("v1 upload: complete",
		"call_id", callID,
		"system_id", systemIDRaw,
		"talkgroup_id", talkgroupIDRaw,
		"audio_path", relPath,
		"api_key_id", apiKeyID,
	)

	c.JSON(http.StatusOK, gin.H{"id": callID, "message": "Call imported successfully."})

	// Downstream + transcription — mirrors legacy handler.
	if h.dsNotifier != nil {
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
	}
	if h.transcriber != nil {
		absPath := filepath.Join(h.processor.RecordingsDir(), relPath)
		if err := h.transcriber.Submit(ctx, audio.TranscriptionJob{
			CallID:    callID,
			AudioPath: absPath,
		}); err != nil {
			slog.Warn("v1 upload: failed to enqueue transcription",
				"call_id", callID, "error", err)
		}
	}
}

// PostCallsTestV1 handles POST /api/v1/calls/test — a connectivity check used
// by recorders to validate their upload config without uploading audio.
//
//	@Summary		Connectivity check
//	@Description	Validates the Bearer API key and returns 204 No Content. Used by recorder plugins to verify their upload configuration without uploading audio.
//	@Tags			v1-Calls
//	@Security		BearerAPIKey
//	@Success		204	"OK — credentials valid"
//	@Failure		401	{object}	shared.APIErrorResponse	"Invalid credentials"
//	@Router			/v1/calls/test [post]
func (h *Handler) PostCallsTestV1(c *gin.Context) {
	if _, ok := c.Get("apiKeyID"); !ok {
		shared.WriteAPIError(c, http.StatusUnauthorized, shared.CodeInvalidCredentials, "API key required", nil)
		return
	}
	c.Status(http.StatusNoContent)
}
