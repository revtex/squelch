# 0011. The SQUELCH wordmark is fixed identity, outside any redesign

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

The admin redesign mockup drew the product name as "Squelch" in the admin's
body face, IBM Plex Sans, beside a small boxed "SQ" mark. The first build
of the new admin sidebar copied that. ADR 0010 gives the admin its own
typeface, so a reader of that record could take the wordmark to be part
of the admin's type too.

The owner said the logo and name should keep the original lettering and
capitals, and that this holds for future design decisions as well.

## Decision

Wherever the product name stands as the brand, it is the original
wordmark: the `font-sign` family (Big Shoulders Display), in capitals,
"SQUELCH", with "SQ" as the short form where space is tight.

- A mockup or redesign does not restyle it. When a design draws the
  brand another way, the build keeps the wordmark and records the
  difference.
- It applies to the scanner, the admin (including its narrow rail), the
  mobile app and any later surface.
- The name in running text, page titles and copy stays "Squelch" in
  normal case and the surrounding face.

## Consequences

- The admin sidebar mixes two faces: the sign face for the brand and Plex
  for everything else. That is intended.
- ADR 0010's typeface decision covers the admin's text, not the brand.
- New surfaces load the sign face wherever they show the brand.

## Alternatives considered

- **Follow the mockup's Plex "Squelch" and "SQ" mark.** The owner chose
  the original wordmark.
- **Let each surface pick its own brand treatment.** This lost because the
  brand would drift with every redesign.
