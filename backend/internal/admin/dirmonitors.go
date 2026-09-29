package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/dirmonitor/status"
)

// MonitorStatus is what the folder monitor service tells the admin about
// each monitor's runtime state.
type MonitorStatus interface {
	Status(id int64) (status.Snapshot, bool)
	Forget(id int64)
}

// recorderTypes are the parsers a monitor can use.
var recorderTypes = map[string]bool{
	"default": true, "dsdplus": true, "proscan": true, "rtlsdr-airband": true,
	"sdr-trunk": true, "trunk-recorder": true,
}

// DirMonitorsList returns every folder monitor with what it is doing.
func (o *Operations) DirMonitorsList(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	dms, err := o.Queries.ListDirMonitors(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list dirmonitors: %w", err)
	}
	out := make([]map[string]any, 0, len(dms))
	for _, d := range dms {
		m := mapDirMonitor(d)
		m["status"] = o.monitorStatus(d)
		out = append(out, m)
	}
	return out, nil
}

// monitorStatus is the runtime block on a monitor row: the row says whether
// it should run, the service says whether it does.
func (o *Operations) monitorStatus(d db.Dirmonitor) map[string]any {
	st := map[string]any{
		"state":       "unknown",
		"error":       "",
		"since":       nil,
		"lastFile":    "",
		"lastFileAt":  nil,
		"lastResult":  "",
		"lastCallId":  nil,
		"ingested24h": int64(0),
	}
	if d.Disabled == 1 {
		st["state"] = "disabled"
	}
	if o.Deps.DirMonitors == nil {
		return st
	}
	snap, ok := o.Deps.DirMonitors.Status(d.ID)
	if !ok {
		if d.Disabled == 0 {
			st["state"] = status.Stopped
			st["error"] = "not started"
		}
		return st
	}
	if d.Disabled == 0 {
		st["state"] = snap.State
		st["error"] = snap.Error
		st["since"] = nullableUnix(snap.Since)
	}
	st["lastFile"] = snap.LastFile
	st["lastFileAt"] = nullableUnix(snap.LastFileAt)
	st["lastResult"] = snap.LastResult
	st["lastCallId"] = nullableUnix(snap.LastCallID)
	st["ingested24h"] = int64(snap.Ingested24h)
	return st
}

type dirMonitorRequest struct {
	ID          int64   `json:"id"`
	Directory   string  `json:"directory"`
	Type        string  `json:"type"`
	Mask        *string `json:"mask"`
	Extension   *string `json:"extension"`
	Frequency   *int64  `json:"frequency"`
	Delay       *int64  `json:"delay"`
	DeleteAfter int64   `json:"deleteAfter"`
	UsePolling  int64   `json:"usePolling"`
	Disabled    int64   `json:"disabled"`
	SystemID    *int64  `json:"systemId"`
	TalkgroupID *int64  `json:"talkgroupId"`
	Order       int64   `json:"order"`
}

func (r *dirMonitorRequest) check() error {
	r.Directory = strings.TrimSpace(r.Directory)
	if r.Directory == "" {
		return UserError("the folder is required")
	}
	if !filepath.IsAbs(r.Directory) {
		return UserError("the folder must be an absolute path on the server")
	}
	if info, statErr := os.Stat(r.Directory); statErr != nil {
		return UserError("the folder does not exist or cannot be read: " + statErr.Error())
	} else if !info.IsDir() {
		return UserError("that path is a file, not a folder: " + r.Directory)
	}
	if r.Type == "" {
		r.Type = "default"
	}
	if !recorderTypes[r.Type] {
		return UserError("unknown recorder type: " + r.Type)
	}
	if r.Delay != nil && *r.Delay < 0 {
		return UserError("the wait before ingest cannot be negative")
	}
	if r.Extension != nil {
		ext := strings.TrimPrefix(strings.TrimSpace(*r.Extension), ".")
		r.Extension = &ext
	}
	return nil
}

func (r *dirMonitorRequest) createParams() db.CreateDirMonitorParams {
	return db.CreateDirMonitorParams{
		Directory:   r.Directory,
		Type:        r.Type,
		Mask:        ptrToNullStr(r.Mask),
		Extension:   ptrToNullStr(r.Extension),
		Frequency:   ptrToNullInt(r.Frequency),
		Delay:       ptrToNullInt(r.Delay),
		DeleteAfter: r.DeleteAfter,
		UsePolling:  r.UsePolling,
		Disabled:    r.Disabled,
		SystemID:    ptrToNullInt(r.SystemID),
		TalkgroupID: ptrToNullInt(r.TalkgroupID),
		Order:       r.Order,
	}
}

// DirMonitorsCreate creates a folder monitor and starts it.
func (o *Operations) DirMonitorsCreate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req dirMonitorRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if err := req.check(); err != nil {
		return nil, err
	}

	id, err := o.Queries.CreateDirMonitor(ctx, req.createParams())
	if err != nil {
		return nil, fmt.Errorf("failed to create dirmonitor: %w", err)
	}

	dm, err := o.Queries.GetDirMonitor(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch created dirmonitor: %w", err)
	}
	o.reloadDirMonitors()
	o.audit(ctx, fmt.Sprintf("admin: folder monitor %s (%s) created by %s", dm.Directory, dm.Type, o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("dirmonitors.updated", nil)
	return mapDirMonitor(dm), nil
}

// DirMonitorsUpdate updates a folder monitor and restarts it.
func (o *Operations) DirMonitorsUpdate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req dirMonitorRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	if err := req.check(); err != nil {
		return nil, err
	}

	existing, err := o.Queries.GetDirMonitor(ctx, req.ID)
	if err != nil {
		return nil, UserError("folder monitor not found")
	}

	p := req.createParams()
	if err := o.Queries.UpdateDirMonitor(ctx, db.UpdateDirMonitorParams{
		ID:          req.ID,
		Directory:   p.Directory,
		Type:        p.Type,
		Mask:        p.Mask,
		Extension:   p.Extension,
		Frequency:   p.Frequency,
		Delay:       p.Delay,
		DeleteAfter: p.DeleteAfter,
		UsePolling:  p.UsePolling,
		Disabled:    p.Disabled,
		SystemID:    p.SystemID,
		TalkgroupID: p.TalkgroupID,
		Order:       p.Order,
	}); err != nil {
		return nil, fmt.Errorf("failed to update dirmonitor: %w", err)
	}

	dm, err := o.Queries.GetDirMonitor(ctx, req.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch updated dirmonitor: %w", err)
	}
	o.reloadDirMonitors()
	o.audit(ctx, changeLine("folder monitor", dm.Directory, existing.Disabled, dm.Disabled, false, o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("dirmonitors.updated", nil)
	return mapDirMonitor(dm), nil
}

// DirMonitorsDelete deletes a folder monitor and stops it.
func (o *Operations) DirMonitorsDelete(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}

	dm, err := o.Queries.GetDirMonitor(ctx, req.ID)
	if err != nil {
		return nil, UserError("folder monitor not found")
	}

	if err := o.Queries.DeleteDirMonitor(ctx, req.ID); err != nil {
		return nil, fmt.Errorf("failed to delete dirmonitor: %w", err)
	}
	if o.Deps.DirMonitors != nil {
		o.Deps.DirMonitors.Forget(req.ID)
	}
	o.reloadDirMonitors()
	o.audit(ctx, fmt.Sprintf("admin: folder monitor %s deleted by %s", dm.Directory, o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("dirmonitors.updated", nil)
	return map[string]bool{"ok": true}, nil
}

// DirMonitorsRestart stops and starts the monitors again, for one that
// stopped after its folder came back or its permissions were fixed.
func (o *Operations) DirMonitorsRestart(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	dm, err := o.Queries.GetDirMonitor(ctx, req.ID)
	if err != nil {
		return nil, UserError("folder monitor not found")
	}
	if dm.Disabled == 1 {
		return nil, UserError("this monitor is disabled; enable it to start it")
	}
	if o.Deps.DirMonitorReload == nil {
		return nil, UserError("folder monitors are not running on this server")
	}
	o.reloadDirMonitors()
	o.audit(ctx, fmt.Sprintf("admin: folder monitor %s restarted by %s", dm.Directory, o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("dirmonitors.updated", nil)
	return map[string]any{"ok": true, "status": o.monitorStatus(dm)}, nil
}

// DirMonitorsTestMask parses an example filename with a mask and returns
// what each token would extract.
func (o *Operations) DirMonitorsTestMask(_ context.Context, params json.RawMessage, _ int64) (any, error) {
	var req struct {
		Mask     string `json:"mask"`
		Filename string `json:"filename"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if o.Deps.MaskTester == nil {
		return nil, UserError("mask testing is not available on this server")
	}
	name := strings.TrimSpace(req.Filename)
	name = strings.TrimSuffix(filepath.Base(name), filepath.Ext(name))
	if req.Mask == "" || name == "" {
		return map[string]any{"ok": false, "values": map[string]string{}}, nil
	}
	values, ok := o.Deps.MaskTester(req.Mask, name)
	if values == nil {
		values = map[string]string{}
	}
	return map[string]any{"ok": ok, "values": values}, nil
}

func (o *Operations) reloadDirMonitors() {
	if o.Deps.DirMonitorReload != nil {
		o.Deps.DirMonitorReload.Reload()
	}
}
