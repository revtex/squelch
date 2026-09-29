package trmqtt

import (
	"encoding/json"
	"fmt"
	"testing"
)

// Each system keeps one latest frame, and the table stays bounded however
// many distinct frames a broker publisher sends.
func TestMergeSystem_KeyedBySystemAndBounded(t *testing.T) {
	s := NewSnapshot(1, "test")
	for i := 0; i < 500; i++ {
		s.mergeSystem(SystemFrame{
			frameCommon: frameCommon{InstanceID: "site-a", Timestamp: json.Number(fmt.Sprint(1700000000 + i))},
			System:      json.RawMessage(`{"sys_num":0,"sys_name":"marcs"}`),
		})
	}
	if got := len(s.Get().SystemFrames); got != 1 {
		t.Fatalf("one system over 500 timestamps kept %d frames, want 1", got)
	}
	if ts := s.Get().SystemFrames["site-a:marcs"].Timestamp; ts != "1700000499" {
		t.Errorf("kept frame timestamp %s, want the latest", ts)
	}

	for i := 0; i < 1000; i++ {
		s.mergeSystem(SystemFrame{
			frameCommon: frameCommon{InstanceID: "site-a"},
			System:      json.RawMessage(fmt.Sprintf(`{"sys_num":%d}`, i)),
		})
	}
	if got := len(s.Get().SystemFrames); got > maxSystemFrames {
		t.Errorf("system table grew to %d, cap is %d", got, maxSystemFrames)
	}
	s.mergeSystem(SystemFrame{
		frameCommon: frameCommon{InstanceID: "site-a", Timestamp: "1800000000"},
		System:      json.RawMessage(`{"sys_name":"marcs"}`),
	})
	if ts := s.Get().SystemFrames["site-a:marcs"].Timestamp; ts != "1800000000" {
		t.Errorf("known system not updated once the table was full (timestamp %s)", ts)
	}
}
