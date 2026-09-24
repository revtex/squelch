# Architecture Decision Records

One file per decision that would be expensive to reverse or confusing to
rediscover. An ADR records *why*, which the code cannot.

## Format

Numbered, append-only, named `NNNN-kebab-summary.md`. Never renumber or rewrite
a committed ADR — supersede it with a new one and mark the old one superseded.

```markdown
# NNNN. Title

- **Status:** Accepted | Superseded by [NNNN](...) | Deprecated
- **Date:** YYYY-MM-DD

## Context
The forces in play. What made this a decision rather than an obvious step.

## Decision
What we chose, in the present tense: "We store X as Y."

## Consequences
What this buys and what it costs — both, honestly. The costs are the part a
future reader needs.

## Alternatives considered
Each real option, and the specific reason it lost. Omit this section rather
than invent it: a reconstructed alternative is worse than none.
```

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-single-binary-embedded-spa.md) | Single binary with embedded SPA | Accepted |
| [0002](0002-two-http-api-surfaces.md) | Two HTTP API surfaces | Accepted |
| [0003](0003-secrets-at-rest.md) | Secrets at rest with frozen key derivation | Superseded by [0006](0006-rotate-key-derivation-with-an-external-tool.md) |
| [0004](0004-background-audio-server-stream.md) | Background audio via a server-side stream | Accepted |
| [0005](0005-rename-to-squelch.md) | Rename to Squelch with compatibility shims | Accepted |
| [0006](0006-rotate-key-derivation-with-an-external-tool.md) | Rotate the key-derivation inputs with an external tool | Accepted |
| [0007](0007-share-link-app-handoff.md) | Hand share links to the app with a custom scheme, not Universal Links | Accepted |
| [0008](0008-ip-blocks-are-global-with-a-server-side-trusted-list.md) | IP blocks are global, with a trusted list only the host can change | Accepted |
| [0009](0009-country-from-a-local-database-only.md) | Country comes from a local database file only | Accepted |

## Not yet written

Decisions that are real and already load-bearing, but whose rationale is not
written down anywhere we can transcribe from. Each needs the person who made it
to fill in the alternatives — do not reconstruct them:

- SQLite in WAL mode, with sqlc and append-only migrations, over an embedded
  alternative or a server database.
- All application configuration in the database rather than in config files.
- JWT access tokens held in memory only, with an httpOnly refresh cookie and
  family rotation.
- Bulletproof React, a single shared RTK Query `api`, and WebSocket frames
  parsed into Redux by middleware rather than by components.
- Two WebSocket channels (`/ws` for listeners, `/api/admin/ws` for admin).
- Trunk Recorder integration over MQTT status only, with audio staying on the
  existing ingest path.
