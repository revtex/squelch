// Package ipblock refuses requests from addresses an admin has blocked, and
// guarantees that trusted addresses can never be blocked.
//
// The trusted list is server configuration (--trusted-addresses), not data,
// so an admin account alone cannot change it: that is what keeps a rogue or
// compromised admin from locking the operator out.
package ipblock

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/netip"
	"sync"
	"sync/atomic"
	"time"

	"github.com/revtex/squelch/internal/db"
)

// Narrowest blocks the guards allow. Anything wider is almost always a
// typo, and would take a large slice of the internet offline for every
// listener and recorder; that belongs in a firewall.
const (
	MinBitsV4 = 16
	MinBitsV6 = 48
)

// warnEvery bounds how often a blocked range is logged, so a recorder
// retrying uploads every second does not flood the log.
const warnEvery = time.Minute

type block struct {
	id      int64
	prefix  netip.Prefix
	expires time.Time // zero = never
}

type snapshot struct {
	blocks []block
}

// Matcher answers "is this address blocked?" from an in-memory copy of the
// ip_blocks table. It is safe for concurrent use; Blocked is lock-free.
type Matcher struct {
	trusted []netip.Prefix
	state   atomic.Pointer[snapshot]

	warnMu   sync.Mutex
	lastWarn map[int64]time.Time // block id → last log line
}

// New returns a matcher with no blocks. trusted is the operator's
// --trusted-addresses list; loopback is always trusted in addition.
func New(trusted []netip.Prefix) *Matcher {
	m := &Matcher{trusted: trusted, lastWarn: map[int64]time.Time{}}
	m.state.Store(&snapshot{})
	return m
}

// Reload replaces the block list from the database. On error the previous
// list stays in force: failing open would silently lift every block.
func (m *Matcher) Reload(ctx context.Context, q *db.Queries) error {
	if m == nil {
		return nil
	}
	rows, err := q.ListActiveIPBlocks(ctx, sql.NullInt64{Int64: time.Now().Unix(), Valid: true})
	if err != nil {
		return fmt.Errorf("load ip blocks: %w", err)
	}
	next := &snapshot{blocks: make([]block, 0, len(rows))}
	for _, r := range rows {
		p, err := netip.ParsePrefix(r.Cidr)
		if err != nil {
			slog.Warn("ipblock: skipping unreadable block", "id", r.ID, "cidr", r.Cidr)
			continue
		}
		b := block{id: r.ID, prefix: p}
		if r.ExpiresAt.Valid {
			b.expires = time.Unix(r.ExpiresAt.Int64, 0)
		}
		next.blocks = append(next.blocks, b)
	}
	m.state.Store(next)
	return nil
}

// Sweep deletes expired blocks and reloads. Expired blocks already stop
// matching on their own; this only keeps the table tidy.
func (m *Matcher) Sweep(ctx context.Context, q *db.Queries) {
	if m == nil {
		return
	}
	if err := q.DeleteExpiredIPBlocks(ctx, sql.NullInt64{Int64: time.Now().Unix(), Valid: true}); err != nil {
		slog.Warn("ipblock: failed to delete expired blocks", "error", err)
	}
	if err := m.Reload(ctx, q); err != nil {
		slog.Warn("ipblock: reload failed; keeping the previous blocks", "error", err)
	}
}

// Trusted reports whether a client can never be blocked. ip is the address
// the router resolved (honouring trusted proxies); peer is the socket
// address. Loopback counts only when both are loopback, so a forwarded
// header claiming 127.0.0.1 does not qualify.
func (m *Matcher) Trusted(ip, peer netip.Addr) bool {
	if m == nil {
		return false
	}
	ip, peer = ip.Unmap(), peer.Unmap()
	if ip.IsLoopback() && peer.IsLoopback() {
		return true
	}
	return m.inTrustedList(ip)
}

// TrustedAddr is Trusted for an address seen without its socket peer, as in
// a device's last address or a history row. It is for display: whether to
// offer "Block address" on a row.
func (m *Matcher) TrustedAddr(ip netip.Addr) bool {
	if m == nil {
		return false
	}
	ip = ip.Unmap()
	return ip.IsLoopback() || m.inTrustedList(ip)
}

func (m *Matcher) inTrustedList(ip netip.Addr) bool {
	for _, p := range m.trusted {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

// TrustedList returns the configured trusted ranges, not including loopback.
func (m *Matcher) TrustedList() []netip.Prefix {
	if m == nil {
		return nil
	}
	return append([]netip.Prefix(nil), m.trusted...)
}

// Blocked reports whether a client must be refused.
func (m *Matcher) Blocked(ip, peer netip.Addr) bool {
	_, ok := m.match(ip, peer)
	return ok
}

// Covers reports whether a new block would catch ip — used to drop live
// connections the moment a block is added.
func Covers(p netip.Prefix, ip netip.Addr) bool {
	return p.Contains(ip.Unmap())
}

func (m *Matcher) match(ip, peer netip.Addr) (block, bool) {
	if m == nil || !ip.IsValid() {
		return block{}, false
	}
	if m.Trusted(ip, peer) {
		return block{}, false
	}
	ip = ip.Unmap()
	now := time.Now()
	for _, b := range m.state.Load().blocks {
		if !b.expires.IsZero() && !now.Before(b.expires) {
			continue
		}
		if b.prefix.Contains(ip) {
			return b, true
		}
	}
	return block{}, false
}

// shouldWarn rate-limits the blocked-request log per block, which bounds
// the map by the number of blocks however many addresses one range holds.
func (m *Matcher) shouldWarn(id int64) bool {
	m.warnMu.Lock()
	defer m.warnMu.Unlock()
	now := time.Now()
	if last, ok := m.lastWarn[id]; ok && now.Sub(last) < warnEvery {
		return false
	}
	m.lastWarn[id] = now
	return true
}

// Refuse reports whether a request must be refused, and logs the first
// refusal per block each minute.
func (m *Matcher) Refuse(ip, peer netip.Addr, path string) bool {
	b, ok := m.match(ip, peer)
	if !ok {
		return false
	}
	if m.shouldWarn(b.id) {
		slog.Warn("ipblock: refused a blocked address", "ip", ip.String(), "block", b.prefix.String(), "path", path)
	}
	return true
}
