package keywordalert

import (
	"regexp"
	"strings"
	"unicode"
)

// MatchResult is which rule labels hit a transcript.
type MatchResult struct {
	Matched bool
	Terms   []string
}

// MatchTranscript finds configured patterns in text (keyword / spoken variants).
func MatchTranscript(transcript string, patterns []string) MatchResult {
	norm := normalize(transcript)
	compact := strings.Join(strings.Fields(strings.ReplaceAll(norm, "-", " ")), " ")
	hit := make([]string, 0)
	seen := map[string]bool{}
	for _, pat := range patterns {
		if pat == "" {
			continue
		}
		pnorm := normalize(pat)
		pcompact := strings.Join(strings.Fields(strings.ReplaceAll(pnorm, "-", " ")), " ")
		if pnorm != "" && (strings.Contains(norm, pnorm) || strings.Contains(compact, pcompact)) {
			if !seen[pat] {
				seen[pat] = true
				hit = append(hit, pat)
			}
			continue
		}
		if isDigits(pnorm) {
			re := regexp.MustCompile(`\b` + regexp.QuoteMeta(pnorm) + `\b`)
			if re.MatchString(norm) && !seen[pat] {
				seen[pat] = true
				hit = append(hit, pat)
			}
		}
	}
	return MatchResult{Matched: len(hit) > 0, Terms: hit}
}

// MatchRulePatterns matches a rule's patterns and reports the rule label when any hit.
func MatchRulePatterns(transcript string, ruleLabel string, patterns []string) MatchResult {
	r := MatchTranscript(transcript, patterns)
	if !r.Matched {
		return r
	}
	return MatchResult{Matched: true, Terms: []string{ruleLabel}}
}

func normalize(text string) string {
	text = strings.ToLower(text)
	text = strings.ReplaceAll(text, "–", "-")
	text = strings.ReplaceAll(text, "—", "-")
	var b strings.Builder
	b.Grow(len(text))
	prevSpace := false
	for _, r := range text {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_':
			b.WriteRune(r)
			prevSpace = false
		case unicode.IsSpace(r):
			if !prevSpace {
				b.WriteByte(' ')
				prevSpace = true
			}
		default:
			if !prevSpace {
				b.WriteByte(' ')
				prevSpace = true
			}
		}
	}
	return strings.TrimSpace(b.String())
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}
