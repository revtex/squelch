package keywordalert

import (
	"fmt"
	"sync"
	"time"
)

// cooldown tracks recent alerts so the same talkgroup+rule does not fire again
// until its window ends.
type cooldown struct {
	mu   sync.Mutex
	until map[string]time.Time
}

func newCooldown() *cooldown {
	return &cooldown{until: map[string]time.Time{}}
}

func cooldownKey(talkgroupID, ruleID int64) string {
	return fmt.Sprintf("%d:%d", talkgroupID, ruleID)
}

// Active reports whether the key is still cooling down.
func (c *cooldown) Active(key string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	exp, ok := c.until[key]
	if !ok {
		return false
	}
	if time.Now().After(exp) {
		delete(c.until, key)
		return false
	}
	return true
}

// Set starts a cooldown window of dur for key.
func (c *cooldown) Set(key string, dur time.Duration) {
	if dur <= 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.until[key] = time.Now().Add(dur)
}
