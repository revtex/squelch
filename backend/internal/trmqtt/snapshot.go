package trmqtt

import (
	"encoding/json"
	"sync"
	"time"
)

// UnitEventEntry is a stored unit-event for the Units view ring buffer.
type UnitEventEntry struct {
	ReceivedAt time.Time
	Topic      string
	Frame      UnitFrame
}

// MessageEntry is a stored trunking-message for the debug pane ring buffer.
type MessageEntry struct {
	ReceivedAt time.Time
	Topic      string
	Frame      MessageFrame
}

// RateSample is one decode-rate datapoint (per system) retained for the
// rolling window.
type RateSample struct {
	At     time.Time
	System string
	Rate   float64
}

// ConnectionState tracks connect/disconnect lifecycle for a snapshot.
type ConnectionState struct {
	Connected     bool
	LastConnected time.Time
	LastError     string
}

// Snapshot is the per-instance live state. All access is serialised by mu.
// Get returns a deep-cloned view safe to hand to a consumer.
type Snapshot struct {
	mu sync.RWMutex

	instanceID int64
	label      string

	conn         ConnectionState
	pluginInst   string // TR-side config.instance_id seen on the wire
	rates        RatesFrame
	recorders    RecordersFrame
	callsActive  CallsActiveFrame
	systemFrames map[string]SystemFrame // keyed by shortname / sys_num as best-effort
	systems      SystemsFrame
	config       ConfigFrame
	pluginStatus PluginStatusFrame

	unitEvents *Ring[UnitEventEntry]
	messages   *Ring[MessageEntry]
	rateSamps  *Ring[RateSample]
}

const (
	unitEventCap  = 5000
	messageCap    = 1000
	rateSampleCap = 1500 // ~5 min at 1 Hz × multiple systems
)

// NewSnapshot allocates a fresh per-instance snapshot.
func NewSnapshot(instanceID int64, label string) *Snapshot {
	return &Snapshot{
		instanceID:   instanceID,
		label:        label,
		systemFrames: make(map[string]SystemFrame),
		unitEvents:   NewRing[UnitEventEntry](unitEventCap),
		messages:     NewRing[MessageEntry](messageCap),
		rateSamps:    NewRing[RateSample](rateSampleCap),
	}
}

// SnapshotView is the cloned, read-only projection returned by Snapshot.Get.
type SnapshotView struct {
	InstanceID       int64
	Label            string
	PluginInstanceID string
	Connection       ConnectionState
	Rates            RatesFrame
	Recorders        RecordersFrame
	CallsActive      CallsActiveFrame
	Systems          SystemsFrame
	Config           ConfigFrame
	PluginStatus     PluginStatusFrame
	SystemFrames     map[string]SystemFrame
	UnitEvents       []UnitEventEntry
	Messages         []MessageEntry
	RateSamples      []RateSample
}

// Get returns a deep clone of the snapshot, safe to read without the lock.
func (s *Snapshot) Get() SnapshotView {
	s.mu.RLock()
	defer s.mu.RUnlock()
	systemFrames := make(map[string]SystemFrame, len(s.systemFrames))
	for k, v := range s.systemFrames {
		systemFrames[k] = v
	}
	return SnapshotView{
		InstanceID:       s.instanceID,
		Label:            s.label,
		PluginInstanceID: s.pluginInst,
		Connection:       s.conn,
		Rates:            s.rates,
		Recorders:        s.recorders,
		CallsActive:      s.callsActive,
		Systems:          s.systems,
		Config:           s.config,
		PluginStatus:     s.pluginStatus,
		SystemFrames:     systemFrames,
		UnitEvents:       s.unitEvents.Snapshot(),
		Messages:         s.messages.Snapshot(),
		RateSamples:      s.rateSamps.Snapshot(),
	}
}

// setConnected marks the snapshot connected; clears any prior error.
func (s *Snapshot) setConnected() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.conn = ConnectionState{Connected: true, LastConnected: time.Now()}
}

// setDisconnected marks the snapshot disconnected with the supplied reason.
func (s *Snapshot) setDisconnected(reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.conn.Connected = false
	s.conn.LastError = reason
}

func (s *Snapshot) setRates(f RatesFrame) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rates = f
}

func (s *Snapshot) setRecorders(f RecordersFrame) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.recorders = f
}

func (s *Snapshot) setCallsActive(f CallsActiveFrame) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.callsActive = f
}

// maxSystemFrames caps the per-instance system table. A trunk-recorder
// instance monitors a handful of systems; the cap only matters if a broker
// publisher sends frames for endless distinct systems.
const maxSystemFrames = 64

func (s *Snapshot) mergeSystem(f SystemFrame) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := f.InstanceID + ":" + systemFrameIdentity(f.System)
	if _, known := s.systemFrames[key]; !known && len(s.systemFrames) >= maxSystemFrames {
		return
	}
	s.systemFrames[key] = f
}

// systemFrameIdentity names the system a /system frame describes, so each
// system keeps one latest frame. It prefers sys_name, then sys_num.
func systemFrameIdentity(raw json.RawMessage) string {
	var id struct {
		SysName   string      `json:"sys_name"`
		Shortname string      `json:"shortname"`
		SysNum    json.Number `json:"sys_num"`
	}
	if len(raw) == 0 || json.Unmarshal(raw, &id) != nil {
		return "_"
	}
	switch {
	case id.SysName != "":
		return id.SysName
	case id.Shortname != "":
		return id.Shortname
	case id.SysNum != "":
		return "#" + id.SysNum.String()
	}
	return "_"
}

func (s *Snapshot) setSystems(f SystemsFrame) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.systems = f
}

func (s *Snapshot) setConfig(f ConfigFrame) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.config = f
	if f.InstanceID != "" {
		s.pluginInst = f.InstanceID
	}
}

func (s *Snapshot) setPluginStatus(f PluginStatusFrame) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pluginStatus = f
}

func (s *Snapshot) appendUnit(topic string, f UnitFrame) {
	s.unitEvents.Push(UnitEventEntry{ReceivedAt: time.Now(), Topic: topic, Frame: f})
}

func (s *Snapshot) appendMessage(topic string, f MessageFrame) {
	s.messages.Push(MessageEntry{ReceivedAt: time.Now(), Topic: topic, Frame: f})
}
