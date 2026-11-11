package keywordalert

import "testing"

func TestMatchTranscript(t *testing.T) {
	patterns := []string{"413", "4-1-3", "four one three", "queen creek"}
	cases := []struct {
		text string
		want bool
	}{
		{"Engine 413 on scene", true},
		{"four one three responding", true},
		{"4-1-3 copy", true},
		{"queen creek and ocotillo", true},
		{"Engine 412 on scene", false},
		{"four fourteen", false},
		{"", false},
	}
	for _, tc := range cases {
		got := MatchTranscript(tc.text, patterns)
		if got.Matched != tc.want {
			t.Errorf("MatchTranscript(%q) matched=%v want %v (terms=%v)", tc.text, got.Matched, tc.want, got.Terms)
		}
	}
}

func TestMatchRulePatternsUsesLabel(t *testing.T) {
	r := MatchRulePatterns("Engine four thirteen enroute", "413", []string{"413", "four thirteen"})
	if !r.Matched || len(r.Terms) != 1 || r.Terms[0] != "413" {
		t.Fatalf("got %+v", r)
	}
}
