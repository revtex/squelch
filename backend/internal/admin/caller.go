package admin

import "context"

// Caller identifies the admin connection an operation arrived on, so a
// listing can mark "this session" and "this device".
type Caller struct {
	ConnID   string
	FamilyID string
}

type callerKey struct{}

// WithCaller attaches the calling connection to ctx.
func WithCaller(ctx context.Context, c Caller) context.Context {
	return context.WithValue(ctx, callerKey{}, c)
}

func callerFrom(ctx context.Context) Caller {
	c, _ := ctx.Value(callerKey{}).(Caller)
	return c
}
