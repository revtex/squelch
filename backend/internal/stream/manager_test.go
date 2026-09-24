package stream

import (
	"bytes"
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/connections"
)

// makeFrame builds a valid MPEG-2 Layer III frame header for the canonical
// stream format (22050 Hz, mono, 32 kbps) followed by filler, so tests can
// exercise the splitter and the queue without invoking FFmpeg.
//
// byte1 = 1111 0011: sync, version 10 (MPEG2), layer 01 (III), no CRC.
// byte2 = 0100 0000: bitrate index 4 (32 kbps), rate index 0 (22050), no pad.
// byte3 = 1100 0000: channel mode 11 (single channel).
func makeFrame(marker byte) []byte {
	const frameLen = 104 // 72 * 32000 / 22050
	f := make([]byte, frameLen)
	f[0], f[1], f[2], f[3] = 0xFF, 0xF3, 0x40, 0xC0
	for i := 4; i < frameLen; i++ {
		f[i] = marker
	}
	return f
}

func TestParseFrameHeader_CanonicalFormat(t *testing.T) {
	f, ok := parseFrameHeader(makeFrame(0x01))
	if !ok {
		t.Fatal("canonical frame header did not parse")
	}
	if f.length != 104 {
		t.Errorf("length = %d, want 104", f.length)
	}
	if f.sampleRate != streamSampleRate {
		t.Errorf("sampleRate = %d, want %d", f.sampleRate, streamSampleRate)
	}
	if f.samples != 576 {
		t.Errorf("samples = %d, want 576 (MPEG-2 Layer III)", f.samples)
	}
	if f.channels != streamChannels {
		t.Errorf("channels = %d, want %d", f.channels, streamChannels)
	}
}

func TestParseFrameHeader_RejectsNonFrames(t *testing.T) {
	cases := map[string][]byte{
		"too short": {0xFF, 0xF3},
		"no sync":   {0x00, 0x00, 0x40, 0xC0},
		// 0xEB sets the version bits to 01, which is reserved.
		"reserved ver": {0xFF, 0xEB, 0x40, 0xC0},
		"free bitrate": {0xFF, 0xF3, 0x00, 0xC0},
		"bad bitrate":  {0xFF, 0xF3, 0xF0, 0xC0},
		"bad rate":     {0xFF, 0xF3, 0x4C, 0xC0},
	}
	for name, b := range cases {
		if _, ok := parseFrameHeader(b); ok {
			t.Errorf("%s: parsed as a valid frame", name)
		}
	}
}

func TestSplitFrames_SkipsID3AndTrailingPartial(t *testing.T) {
	a, b := makeFrame(0xAA), makeFrame(0xBB)

	// ID3v2 header declaring a 3-byte body, then two whole frames, then a
	// truncated one that must not be emitted.
	var buf bytes.Buffer
	buf.WriteString("ID3")
	buf.Write([]byte{0x04, 0x00, 0x00, 0, 0, 0, 3})
	buf.Write([]byte{0x11, 0x22, 0x33})
	buf.Write(a)
	buf.Write(b)
	buf.Write(a[:20])

	frames := splitFrames(buf.Bytes())
	if len(frames) != 2 {
		t.Fatalf("got %d frames, want 2", len(frames))
	}
	if !bytes.Equal(frames[0], a) || !bytes.Equal(frames[1], b) {
		t.Error("frames did not round-trip intact")
	}
}

func newTestManager(t *testing.T, source CallSource, filter Filter) *Manager {
	t.Helper()
	m := New(source, filter)
	// Stand in for Start() so the tests do not require FFmpeg.
	m.silence = [][]byte{makeFrame(0x00)}
	m.period = 576 * time.Second / streamSampleRate
	return m
}

func TestListenerEnqueue_DropsOldestOverCap(t *testing.T) {
	l := &listener{userID: 7}
	older := makeFrame(0x01)
	newer := makeFrame(0x02)

	l.enqueue(1, [][]byte{older, older, older}, 0) // 0 = uncapped
	l.enqueue(2, [][]byte{newer, newer}, 2)

	if got := l.queued(); got != 2 {
		t.Fatalf("queued = %d, want 2 after the cap trimmed the backlog", got)
	}
	// A scanner backlog is stale, so the cap must discard the oldest audio
	// and keep the newest — not the other way round.
	for i := 0; i < 2; i++ {
		if frame, _, _ := l.next(nil); !bytes.Equal(frame, newer) {
			t.Fatalf("frame %d is not the newest audio", i)
		}
	}
}

func TestListenerNext_CyclesSilenceWhenIdle(t *testing.T) {
	l := &listener{}
	s0, s1 := makeFrame(0xE0), makeFrame(0xE1)
	silence := [][]byte{s0, s1}

	got := make([][]byte, 0, 3)
	for i := 0; i < 3; i++ {
		frame, _, _ := l.next(silence)
		got = append(got, frame)
	}
	if !bytes.Equal(got[0], s0) || !bytes.Equal(got[1], s1) || !bytes.Equal(got[2], s0) {
		t.Error("silence did not cycle")
	}
}

func TestNotify_ConsultsFilterPerListener(t *testing.T) {
	call := Call{ID: 42, SystemID: 1, TalkgroupID: 27501, AudioPath: "/tmp/call.m4a"}
	source := func(_ context.Context, id int64) (Call, error) {
		if id != 42 {
			t.Errorf("source got call id %d, want 42", id)
		}
		return call, nil
	}
	// Only user 1 has this talkgroup enabled.
	filter := func(_ context.Context, userID int64, c Call) bool {
		if c.TalkgroupID != 27501 {
			t.Errorf("filter got talkgroup %d", c.TalkgroupID)
		}
		return userID == 1
	}

	m := newTestManager(t, source, filter)
	var encodes int
	m.encode = func(context.Context, string) ([][]byte, error) {
		encodes++
		return [][]byte{makeFrame(0x77), makeFrame(0x78)}, nil
	}

	allowed := &listener{userID: 1}
	denied := &listener{userID: 2}
	m.add(allowed)
	m.add(denied)

	m.Notify(context.Background(), 42)

	if allowed.queued() != 2 {
		t.Errorf("allowed listener queued %d frames, want 2", allowed.queued())
	}
	if denied.queued() != 0 {
		t.Errorf("denied listener queued %d frames, want 0", denied.queued())
	}
	// The call is transcoded once and the frames shared, so cost does not
	// scale with the number of listeners.
	if encodes != 1 {
		t.Errorf("encoded %d times, want exactly 1", encodes)
	}
}

func TestNotify_NoListenersDoesNoWork(t *testing.T) {
	m := newTestManager(t,
		func(context.Context, int64) (Call, error) {
			t.Fatal("resolved a call with nobody listening")
			return Call{}, nil
		},
		nil,
	)
	m.Notify(context.Background(), 1)
}

// syncBuffer is an io.Writer safe to read from while Serve writes.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}

func (s *syncBuffer) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Len()
}

func TestServe_PrimesBufferThenStopsOnCancel(t *testing.T) {
	m := newTestManager(t, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())

	var out syncBuffer
	done := make(chan error, 1)
	go func() { done <- m.Serve(ctx, connections.Conn{UserID: 5}, "sid-test", &out, nil) }()

	// The prime is written before pacing starts, so it lands immediately.
	deadline := time.After(2 * time.Second)
	wantPrime := int(primeSeconds*time.Second/m.period) * 104
	for out.Len() < wantPrime {
		select {
		case <-deadline:
			t.Fatalf("primed only %d bytes, want %d", out.Len(), wantPrime)
		case <-time.After(5 * time.Millisecond):
		}
	}

	if m.ListenerCount() != 1 {
		t.Errorf("ListenerCount = %d, want 1", m.ListenerCount())
	}

	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Error("Serve returned nil; a cancelled stream should report why it ended")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Serve did not return after cancel")
	}

	if m.ListenerCount() != 0 {
		t.Errorf("ListenerCount = %d after disconnect, want 0", m.ListenerCount())
	}
}

func TestServe_RequiresStart(t *testing.T) {
	m := New(nil, nil)
	if err := m.Serve(context.Background(), connections.Conn{UserID: 1}, "", &syncBuffer{}, nil); err == nil {
		t.Error("Serve succeeded before Start; it must refuse to stream without silence")
	}
}

// cueRecord is one observed stream.cue.
type cueRecord struct {
	userID int64
	sid    string
	callID int64
	offset float64
}

func TestListenerNext_MarksOnlyTheFirstFrameOfACall(t *testing.T) {
	l := &listener{userID: 7, sid: "s"}
	silence := [][]byte{makeFrame(0x00)}

	// One silence frame goes out first, then a two-frame call.
	if _, id, at := l.next(silence); id != 0 || at != 0 {
		t.Fatalf("silence frame reported callID=%d at=%d, want 0 and 0", id, at)
	}
	l.enqueue(42, [][]byte{makeFrame(0x01), makeFrame(0x02)}, 0)

	_, id, at := l.next(silence)
	if id != 42 {
		t.Errorf("first call frame reported callID=%d, want 42", id)
	}
	if at != 1 {
		t.Errorf("first call frame at frame %d, want 1 (one silence frame preceded it)", at)
	}
	// Only the first frame marks the call; cueing on every frame would
	// re-label continuously for the whole call.
	if _, id, _ := l.next(silence); id != 0 {
		t.Errorf("second call frame reported callID=%d, want 0", id)
	}
}

func TestServe_CuesCallAtItsActualStreamOffset(t *testing.T) {
	call := Call{ID: 99, SystemID: 1, TalkgroupID: 2, AudioPath: "x.wav"}
	m := newTestManager(t,
		func(context.Context, int64) (Call, error) { return call, nil },
		nil)
	// Two frames of "call audio", no FFmpeg needed.
	m.encode = func(context.Context, string) ([][]byte, error) {
		return [][]byte{makeFrame(0x01), makeFrame(0x02)}, nil
	}

	cues := make(chan cueRecord, 4)
	m.SetCuePublisher(func(userID int64, sid string, callID int64, offset float64) {
		cues <- cueRecord{userID, sid, callID, offset}
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var out syncBuffer
	go func() { _ = m.Serve(ctx, connections.Conn{UserID: 7}, "tab-a", &out, nil) }()

	// Let the prime drain so the call lands during paced streaming.
	time.Sleep(200 * time.Millisecond)
	m.Notify(context.Background(), 99)

	select {
	case c := <-cues:
		if c.userID != 7 || c.sid != "tab-a" || c.callID != 99 {
			t.Errorf("cue = %+v, want userID 7 / sid tab-a / callID 99", c)
		}
		// The offset must be where the call actually starts on this
		// listener's timeline: at least the prime, since the prime is
		// written before the call could possibly be queued. A client
		// schedules its label against exactly this number.
		minOffset := float64(primeSeconds)
		if c.offset < minOffset {
			t.Errorf("offset = %.3f, want >= %.3f (the prime precedes the call)",
				c.offset, minOffset)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no stream.cue was published for a call that was queued")
	}

	// Exactly one cue per call — not one per frame.
	select {
	case c := <-cues:
		t.Errorf("a second cue was published for the same call: %+v", c)
	case <-time.After(300 * time.Millisecond):
	}
}

func TestServe_NoCuePublisherIsSafe(t *testing.T) {
	call := Call{ID: 1, AudioPath: "x.wav"}
	m := newTestManager(t,
		func(context.Context, int64) (Call, error) { return call, nil }, nil)
	m.encode = func(context.Context, string) ([][]byte, error) {
		return [][]byte{makeFrame(0x01)}, nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var out syncBuffer
	go func() { _ = m.Serve(ctx, connections.Conn{UserID: 1}, "", &out, nil) }()
	time.Sleep(150 * time.Millisecond)

	// Must not panic with no publisher registered.
	m.Notify(context.Background(), 1)
	time.Sleep(150 * time.Millisecond)
}

// Revoking a session must end the open stream: a disabled user or a logged-out
// token keeps no live audio feed.
func TestDisconnect_EndsMatchingStreamsOnly(t *testing.T) {
	tests := []struct {
		name       string
		disconnect func(m *Manager)
	}{
		{name: "by user", disconnect: func(m *Manager) { m.DisconnectUser(5) }},
		{name: "by jti", disconnect: func(m *Manager) { m.DisconnectJTI("jti-a") }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			m := newTestManager(t, nil, nil)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			target := make(chan error, 1)
			other := make(chan error, 1)
			go func() { target <- m.Serve(ctx, connections.Conn{UserID: 5, JTI: "jti-a"}, "", &syncBuffer{}, nil) }()
			go func() { other <- m.Serve(ctx, connections.Conn{UserID: 6, JTI: "jti-b"}, "", &syncBuffer{}, nil) }()

			deadline := time.After(2 * time.Second)
			for m.ListenerCount() != 2 {
				select {
				case <-deadline:
					t.Fatalf("ListenerCount = %d, want 2", m.ListenerCount())
				case <-time.After(5 * time.Millisecond):
				}
			}

			tc.disconnect(m)

			select {
			case err := <-target:
				if !errors.Is(err, context.Canceled) {
					t.Errorf("Serve returned %v, want context.Canceled", err)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("revoked stream kept running")
			}
			select {
			case err := <-other:
				t.Fatalf("unrelated stream ended: %v", err)
			case <-time.After(100 * time.Millisecond):
			}
			if m.ListenerCount() != 1 {
				t.Errorf("ListenerCount = %d, want 1", m.ListenerCount())
			}
		})
	}
}

// A stream shows up in the connection list while it plays, can be ended from
// there, and leaves the list when it ends.
func TestServe_ReportsToConnectionRegistry(t *testing.T) {
	m := newTestManager(t, nil, nil)
	reg := connections.New()
	m.SetConnections(reg)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	who := connections.Conn{UserID: 9, Username: "bob", JTI: "jti-9", FamilyID: "fam-9"}
	done := make(chan error, 1)
	go func() { done <- m.Serve(ctx, who, "sid", &syncBuffer{}, nil) }()

	deadline := time.After(2 * time.Second)
	for reg.Len() != 1 {
		select {
		case <-deadline:
			t.Fatalf("registry Len = %d, want 1", reg.Len())
		case <-time.After(5 * time.Millisecond):
		}
	}
	got := reg.List()[0]
	if got.Kind != connections.KindStream || got.ID == "" || got.UserID != 9 ||
		got.Username != "bob" || got.FamilyID != "fam-9" {
		t.Fatalf("registry entry = %+v", got)
	}

	if !reg.Close(got.ID) {
		t.Fatal("Close = false, want true")
	}
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Errorf("Serve returned %v, want context.Canceled", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("stream kept running after registry Close")
	}
	if reg.Len() != 0 {
		t.Errorf("registry Len = %d after the stream ended, want 0", reg.Len())
	}
}
