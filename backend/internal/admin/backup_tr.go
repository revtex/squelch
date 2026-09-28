package admin

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
)

// Trunk Recorder MQTT brokers (tr_instances) in a configuration backup.
// The broker password travels as stored: enc:: when the server encrypts
// secrets, so it restores only where the same --encryption-key is set.

// TRInstanceSync restarts or stops the live MQTT client for one broker row
// after a restore rewrote it. The trmqtt Manager implements it.
type TRInstanceSync interface {
	Update(ctx context.Context, id int64) error
	Remove(ctx context.Context, id int64) error
}

// importTRInstance is the flat shape a backup carries for a broker, like
// importDownstream: plain values instead of sql.Null* objects.
type importTRInstance struct {
	ID            int64   `json:"id"`
	Label         string  `json:"label"`
	InstanceID    string  `json:"instance_id"`
	BrokerURL     string  `json:"broker_url"`
	BaseTopic     string  `json:"base_topic"`
	UnitTopic     *string `json:"unit_topic"`
	MessageTopic  *string `json:"message_topic"`
	Username      *string `json:"username"`
	PasswordEnc   *string `json:"password_enc"`
	TLSSkipVerify int64   `json:"tls_skip_verify"`
	QoS           int64   `json:"qos"`
	Enabled       int64   `json:"enabled"`
}

func flattenTRInstances(rows []db.TrInstance) []importTRInstance {
	out := make([]importTRInstance, len(rows))
	for i, r := range rows {
		out[i] = importTRInstance{ID: r.ID, Label: r.Label, InstanceID: r.InstanceID, BrokerURL: r.BrokerUrl, BaseTopic: r.BaseTopic,
			UnitTopic: nullStr(r.UnitTopic), MessageTopic: nullStr(r.MessageTopic), Username: nullStr(r.Username),
			PasswordEnc: nullStr(r.PasswordEnc), TLSSkipVerify: r.TlsSkipVerify, QoS: r.Qos, Enabled: r.Enabled}
	}
	return out
}

// trInstanceRows keys brokers by label, which is unique. The password is
// compared as stored.
func trInstanceRows(rows []importTRInstance) []keyedRow {
	out := make([]keyedRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, keyedRow{
			key:  r.Label,
			name: r.Label,
			print: joinPrint(r.InstanceID, r.BrokerURL, r.BaseTopic, strPtr(r.UnitTopic), strPtr(r.MessageTopic), strPtr(r.Username),
				strPtr(r.PasswordEnc), strconv.FormatInt(r.TLSSkipVerify, 10), strconv.FormatInt(r.QoS, 10), strconv.FormatInt(r.Enabled, 10)),
		})
	}
	return out
}

// checkTRSecrets refuses broker passwords this server could not decrypt.
func checkTRSecrets(rows []importTRInstance, encKey string) error {
	for _, r := range rows {
		if r.PasswordEnc == nil || !auth.IsEncrypted(*r.PasswordEnc) {
			continue
		}
		if encKey == "" {
			return UserError("the backup holds encrypted Trunk Recorder broker passwords but this server has no encryption key; start it with --encryption-key first")
		}
		if _, err := auth.DecryptString(*r.PasswordEnc, encKey); err != nil {
			return UserError("the backup holds Trunk Recorder broker passwords this server's encryption key cannot read; it needs the key the backup was made with")
		}
	}
	return nil
}

// restoreTRInstances creates or updates each broker in the file, matched
// by label, and returns the rows to keep for Replace.
func restoreTRInstances(ctx context.Context, qtx *db.Queries, rows []importTRInstance, now int64, res *RestoreResult) (map[int64]bool, error) {
	keep := map[int64]bool{}
	for _, r := range rows {
		if r.Label == "" || r.BrokerURL == "" {
			slog.Warn("restore: skipping Trunk Recorder broker without a label or URL", "label", r.Label)
			continue
		}
		existing, err := qtx.GetTRInstanceByLabel(ctx, r.Label)
		if err != nil {
			row, cerr := qtx.CreateTRInstance(ctx, db.CreateTRInstanceParams{
				Label: r.Label, InstanceID: r.InstanceID, BrokerUrl: r.BrokerURL, BaseTopic: r.BaseTopic,
				UnitTopic: ptrToNullStr(r.UnitTopic), MessageTopic: ptrToNullStr(r.MessageTopic), Username: ptrToNullStr(r.Username),
				PasswordEnc: ptrToNullStr(r.PasswordEnc), TlsSkipVerify: r.TLSSkipVerify, Qos: r.QoS, Enabled: r.Enabled,
				CreatedAt: now, UpdatedAt: now,
			})
			if cerr != nil {
				return nil, fmt.Errorf("failed to restore Trunk Recorder broker %q: %w", r.Label, cerr)
			}
			keep[row.ID] = true
			res.Created++
			continue
		}
		if _, err := qtx.UpdateTRInstance(ctx, db.UpdateTRInstanceParams{
			ID: existing.ID, Label: r.Label, InstanceID: r.InstanceID, BrokerUrl: r.BrokerURL, BaseTopic: r.BaseTopic,
			UnitTopic: ptrToNullStr(r.UnitTopic), MessageTopic: ptrToNullStr(r.MessageTopic), Username: ptrToNullStr(r.Username),
			PasswordEnc: ptrToNullStr(r.PasswordEnc), TlsSkipVerify: r.TLSSkipVerify, Qos: r.QoS, Enabled: r.Enabled, UpdatedAt: now,
		}); err != nil {
			return nil, fmt.Errorf("failed to update Trunk Recorder broker %q: %w", r.Label, err)
		}
		keep[existing.ID] = true
	}
	return keep, nil
}

// removeAbsentTR deletes the brokers a Replace file does not carry.
func removeAbsentTR(ctx context.Context, qtx *db.Queries, keep map[int64]bool) (int, error) {
	rows, err := qtx.ListTRInstances(ctx)
	if err != nil {
		return 0, fmt.Errorf("failed to list Trunk Recorder brokers: %w", err)
	}
	removed := 0
	for _, r := range rows {
		if keep[r.ID] {
			continue
		}
		if err := qtx.DeleteTRInstance(ctx, r.ID); err != nil {
			return 0, fmt.Errorf("failed to remove Trunk Recorder broker %q: %w", r.Label, err)
		}
		removed++
	}
	return removed, nil
}

// syncTRInstances brings the live MQTT clients in line with the restored
// rows: enabled brokers reconnect with their new settings, disabled and
// removed ones disconnect. before is the broker list from ahead of the
// restore, so removed rows can be stopped too.
func (o *Operations) syncTRInstances(ctx context.Context, before []db.TrInstance) {
	if o.Deps.TRInstances == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	after, err := o.Queries.ListTRInstances(ctx)
	if err != nil {
		slog.Warn("restore: could not list Trunk Recorder brokers to reconnect them", "error", err)
		return
	}
	present := make(map[int64]bool, len(after))
	for _, r := range after {
		present[r.ID] = true
		var serr error
		if r.Enabled == 1 {
			serr = o.Deps.TRInstances.Update(ctx, r.ID)
		} else {
			serr = o.Deps.TRInstances.Remove(ctx, r.ID)
		}
		if serr != nil {
			slog.Warn("restore: Trunk Recorder broker did not reconnect", "label", r.Label, "error", serr)
		}
	}
	for _, r := range before {
		if present[r.ID] {
			continue
		}
		if err := o.Deps.TRInstances.Remove(ctx, r.ID); err != nil {
			slog.Warn("restore: removed Trunk Recorder broker did not disconnect", "label", r.Label, "error", err)
		}
	}
}
