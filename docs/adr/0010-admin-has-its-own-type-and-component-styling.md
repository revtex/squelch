# 0010. The admin has its own type and component styling, derived from the scanner theme

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

The admin redesign was drawn as an interactive mockup, and the owner asked
for the built admin to look and feel like it. The pages were built from
DaisyUI's default components. Those look nothing like the mockup's:

- The mockup's buttons are bordered and 40 px tall, and the primary is gold.
- Its badges are 4 px tinted rectangles.
- Tabs carry a gold underline, and switches turn green when on.
- Checkboxes are square.
- Table headers are small uppercase text.
- The type is IBM Plex Sans and Mono, where the scanner uses Selawik and
  JetBrains Mono.

The mockup was drawn in the Midnight palette. The admin follows the
listener's picked theme, of seven, and the default is Squelch classic. The
owner decided that the admin maps the mockup's colour roles onto the picked
theme, with Midnight matching the mockup exactly. The type is installed
self-hosted and used in the admin only.

The admin is about 70 component files. They use DaisyUI classes everywhere:
roughly 140 buttons, 250 badges, 240 selects and 140 alerts. The
conventions say to use DaisyUI's classes rather than hand-rolled
equivalents.

## Decision

One style layer, `frontend/src/admin.css`, gives the DaisyUI classes the
mockup's look inside the admin. Pages keep writing `btn`, `badge`, `tab`,
`toggle`, `checkbox`, `input`, `select`, `alert` and `table`.

- **Scope.** Every rule is under `.admin-ui`, the class on the admin shell's
  root. The scanner is untouched.
- **Cascade.** The rules sit in the `utilities.admin` sublayer, declared after
  DaisyUI's `utilities.daisyui…` sublayers. So they beat any DaisyUI rule, and
  a Tailwind utility on the element still beats them.
- **Colours are roles derived from the theme.** Each mockup colour is a theme
  colour or a `color-mix()` of two. Examples: `--admin-line` mixes the text
  colour into `base-300`, and the danger tints mix `error` into `base-100`.
  All seven themes follow. A `[data-theme="squelch-midnight"]` block pins
  the mockup's exact values where a mix lands a shade off. That block is the
  only literal palette in the file.
- **Roles as Tailwind colours.** New shapes the mockup has and DaisyUI lacks,
  such as a card with a header bar or a stat tile, are React primitives. They
  use Tailwind utilities with these colours: `border-admin-line`,
  `bg-admin-ok-bg`, `text-admin-warn-fg` and the rest are registered in
  `index.css`.
- **Type.** IBM Plex Sans 400/500/600 and IBM Plex Mono 400/500 are vendored
  as Latin woff2 in `src/assets/fonts/`, with their OFL licences. `.admin-ui`
  redefines `--font-sans` and `--font-mono`, so `font-mono` in the admin is
  Plex Mono. The base is 14 px, line height 1.45.

## Consequences

- One file restyles every page, and page code keeps DaisyUI's names.
- There are now two looks for one set of class names. Inside the admin, `btn`
  and the other DaisyUI classes don't look like DaisyUI's documentation. A
  reader has to know `admin.css` exists; the file's header says so.
- Theme colours defined only for the scanner now also drive the admin.
  Changing a palette in squelch-mobile's tokens changes the admin too.
  Midnight's pinned values do not move with it.
- The scanner and the admin use different typefaces. The web app ships five
  more font files, about 100 KB, which load only when the admin renders.
- Utility colours with an opacity, such as `text-base-content/60`, don't
  follow the layer. Admin code uses `text-base-content-dim` and the
  `admin-*` colours instead.
- Squelch classic's bright green primary and red error make the tinted mixes
  louder than in Midnight. A separate change tones classic down.

## Alternatives considered

- **Restyle each page by hand with utilities.** This lost on size and drift.
  It means about 800 class edits across 70 files, and every new page has to
  repeat them. It also leaves DaisyUI's defaults as the default.
- **Replace DaisyUI in the admin with custom components.** This lost for the
  same reason, and it goes against the rule to use DaisyUI rather than
  hand-roll its equivalents.
- **One fixed palette for the admin, the mockup's Midnight colours, whatever
  the theme.** The owner chose to follow the picked theme, so the admin and
  the scanner stay one product.
- **Load IBM Plex from Google Fonts.** This lost because the app already
  self-hosts its fonts. A runtime font CDN is an outbound request from every
  admin's browser and fails on LAN-only installs.
