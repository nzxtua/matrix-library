# matrix-flashlight

A UV flashlight and fluorescent ink. The page is black. The beam is a
blacklight: whatever it finds, glows. It finds falling rain, a giant
wordmark (`SPEDION` / `INTEGRATION`, set in `src/content/site.json`), three
small things hidden in the dark, and an `ENTER` pill.
`ENTER` floods the screen with light and opens the content page: a Markdown
document with a section panel, a map of the document and a set of reading
tools. Several Markdown files make a library: one page per document. After `ENTER` the light does not leave. It becomes the tools: search,
searchlight, echo, ruler, lights out, map.

Stack: [TanStack Start](https://tanstack.com/start) in SPA mode, React 19,
[Vite+](https://viteplus.dev) (`vp`), [marked](https://marked.js.org). No other
runtime dependency: plain React, CSS and canvas.

## Commands

```bash
vp install    # install dependencies
vp dev        # dev server on http://localhost:3000 (same as `pnpm dev`)
vp check      # format, lint and type checks
vp test       # unit tests of the pure modules (`src/lib/*.test.ts`)
vp build      # production build
vp preview    # serve the production build
```

`vp build` writes a static SPA to `dist/client`. The entry file is
`dist/client/_shell.html`: point every route of your static host at it.

## Content

The site shows whatever these files hold. Replace them to change the page; no
code change is needed.

| File                    | Shown as                                                     |
| ----------------------- | ------------------------------------------------------------ |
| `src/content/*.md`      | The documents. GitHub-flavoured Markdown. One page per file. |
| `src/content/logo.png`  | The logo, traced into a 3D relief in the browser.            |
| `src/content/site.json` | Settings. `wordmark`: the giant words on the Enter page.     |

- Every `*.md` file in `src/content` (not in subfolders) is a document. Its
  address is its file name as a slug: `02 Setup.md` is `/content/02-setup`.
- Order: by file name, numbers read as numbers (`2-…` before `10-…`). Put a
  number in front of the names to set the order.
- `/content` is always the library, with one file or with several. An old
  `/content#<id>` address opens the document that has that id.

- `wordmark` makes two rows: above and below `ENTER`. A `/` sets the break
  (`"Spedion / integration"`). Without one, the text breaks at the space that
  makes the rows closest in length. One word is one row, above `ENTER`. The
  letters are drawn in capitals. A row too long for the screen gets smaller
  letters; a row of 4 letters or fewer is set wide. An empty or missing
  `wordmark` shows `LIGHTS` / `OUT`.

- The first heading is the page title. Headings of level 1 and 2 become the
  navigation. A leading code in a heading ("A1.", "Part A.", "3.2") is lifted
  out by pattern; a heading without one works the same.
- Raw HTML in the Markdown is shown as text. It is never executed.
- A relative link has no target on this site. It is shown as a chip; a click
  copies its address.
- `src/content` is excluded from the formatter (`fmt.ignorePatterns`).
- All of them are bundled into the client build. Anyone who can open the
  deployed site can read them.

## The flow

```text
/ (Enter page)
  dark ──beam finds──▶ idle ──ENTER──▶ flooding ──▶ loading ──▶ lights on ──▶ /content
  black page           wordmark,        the beam     fill eases   fill ends,    rain falls
                       objects, pill    grows over   to 85 %      a beat        away, page
                                        the screen                              appears
```

| Phase     | First visit | Returning reader (`prefs.seen`) |
| --------- | ----------- | ------------------------------- |
| flooding  | 1.7 s       | 0.8 s                           |
| loading   | 3.4 s       | 1.4 s                           |
| fill ends | 0.24 s      | 0.16 s                          |
| lights on | 0.36 s      | 0.2 s                           |

- `ENTER` always opens the library (`/content`), even with one document.
- The loader is honest. The fill eases to 85 % on a timer. It completes only
  when `router.preloadRoute` of the library settles, so a slow load waits at
  85 %.
- Captions under the pill (a live region): `finding the switch`,
  `warming the tubes`, `lights on`.
- A second click, `Enter` or `Escape` during the show skips to the library.
- A returning reader with a reading place sees a second, smaller button under
  the pill: `continue · 61%`. It opens `/content/<slug>#<last block>` of the
  document the reader was in last. The percent is the read share of that
  document, never document text.
- A document opens under the same full-screen rain. After 350 ms the rain
  stops spawning, speeds up and falls off the screen. A direct visit plays the
  same intro. With less motion there is no rain intro.
- After 10 s with the beam on the pill, the label scrambles to `WELL?`.

## Features

### Enter page

- The beam takes the colours of the vibe. It works without a mouse: an idle
  sweep, arrow keys, the wheel, and touch (the light stays 1.2 s after the
  finger lifts).
- Everything on the page exists only in the light. Each lit element
  (`[data-lit]`) gets its own `--lit` (0..1) from the beam. The giant outlined
  letters of the wordmark swell in weight and width as the beam passes, each
  inside a fixed slot.
- Three found objects: a moth, a light switch, a spare battery. Click one, or
  press `Enter`, while it is lit. The counter shows `1/3`. All three unlock
  the `cryo` vibe: `3/3 · cryo unlocked`.
- The vibe dots (bottom right) and the hint line (bottom left, after 3 s) are
  lit by the beam too.
- Afterglow: the wordmark is phosphorescent ink. A letter lights at once and
  fades with a half-life of 1.2 s, so the beam leaves a trail. With less
  motion it goes dark at once.
- The letters are 3D. Each has depth (three dimmer copies of its outline,
  each further back) and turns to face the beam as far as it is lit, so its
  thickness shows on the side away from the light. A lit letter comes
  forward. In the core of the light a letter fills with code: falling glyphs
  in its ink, in two layers at different speeds, clipped to its shape. A
  letter that comes out of the dark into the beam decodes: it runs through
  other characters for half a second before it settles. With less motion
  there is no turn, no decoding, and the code stands still.
- The pointer on ENTER slows time in the rain: the 2D rain, the deep and the
  code in the letters fall at about a fifth of their pace, and ease back when
  it leaves.
- The deep (Three.js, WebGL), under the wordmark. Streams of the same glyphs
  stand far behind it, in depth, and exist only in the light: the beam lights
  them with its own falloff. The room moves a little with the beam, near
  streams more than far ones. The beam is also a cone of haze from the
  reader's hand, below the screen, to the lit spot, with dust that shows only
  inside it. On ENTER the reader falls into the code: the deep rain comes at
  the camera faster and faster, light streaks past and the room rolls a
  little. With less motion the deep is a still and there is no fall. Without
  WebGL the page is the same, without the deep.

### Library

`/content` is the library: the wordmark as a poster and one card per
document, in order. Above the wordmark: `content · 3 documents · ≈ 12 min`.
The tab title is `Site content`. A card shows the file name, the title,
minutes, sections and tables, and how much of it is lit: a ring, `61% lit`, a
line of light along the bottom edge, and the big number filled with ink from
the bottom by the same share. `you were here` marks the document `continue` opens.
The edge of each card glows where the pointer is (with less motion: the whole
card, on hover).

Behind the cards is a 3D room (Three.js, WebGL). Right of the wordmark, one
glass pod per document stands on a curved shelf, like the pods of the film.
Each holds ink up to the share that is lit; a full pod glows; the pod
`continue` opens has a ring of light on the floor. The rain of the Enter page
falls in depth around them, in the ink of the vibe, brighter where the beam
from above crosses it. The pods rise one after the other with the cards, and
their filaments flicker before they hold. The pointer turns the room a little.
A card under the pointer, or in focus, lifts its pod and drops the room into
bullet time: the rain all but stops. On a phone the shelf is smaller and
dimmer, above the title. With less motion the room is a still. Without WebGL
the library is the same, without the room. `three` loads only on this page.

### Content page

- **Between documents.** Above the title: `library`, the place
  on the shelf (`02 / 05`) and `← previous` / `next →` to the documents
  beside it (dim where there is none). Every part of the row is solid, so the
  rain of bullet time never runs through it; on a phone the steps wrap to a
  second line. Under
  the last block: a card for the next document. After the last one, the end
  card (`end of the shelf`) leads back to the library: `that was the last one.`
  in outlined ink, and one tube per document, filled by its read share; the
  open one is ringed.
- **Bullet time.** Round the poster title stands a frozen moment in 3D
  (Three.js, WebGL). Code rain hangs in depth behind the title, stopped in
  mid-fall. Bullets cross it from the back left toward the reader, frozen in
  flight: 3D metal with a flat base, a straight body with rifling marks and a
  round nose, in front. Each spins on its axis while time runs, and leaves a
  tracer from its base and a wake of air rings that widen
  behind it; seen in perspective, a ring is an ellipse. The pointer swings
  the scene round the title, slowly, like the camera of the film. A click in
  the title block (not on a link) lets time run for about a second: the rain
  falls, the bullets fly on, then all of it slows back into bullet time. A
  bullet that leaves at the right comes back in at the left. Scrolling lets
  a little time through. The scene comes once the rain the page opens under
  has fallen away, with time still running, and freezes. It fades out just
  under the title block, and the stats chips are solid, so nothing of it lies
  behind the text. With less motion it is a still, and a click does nothing.
  Without WebGL the title stands on the page as before. `three` loads only
  after the page is up.
- **The water.** The card of the next document (or the end card) stands on
  still water (Three.js, WebGL) at the foot of the page, and the water
  reflects it, flipped at its foot: its face and edge, its words in their
  fonts and colours, its arrow and its tubes. A lit card is lit in the water
  too. Wind runs across in long low waves and draws the reflection out into
  streaks the further it lies from the card; the crests catch the ink of the
  vibe. Rain falls into it: now and then a drop rings out somewhere on the
  pool. The pointer leaves a wake over the water, a press splashes. The pool
  settles in the first time the card comes into view, with one drop. It is
  as deep as the room under the card (170 px at most). With less motion it is
  still water. Without WebGL there is none.
- **Document.** Poster title with stats chips, part headings with an eyebrow,
  section headings with a code chip and a `#` button that copies the link.
  Inline code is a calm chip; a click echoes it. A meta line (short plain
  facts joined by `·`, as `Acme · Berlin · Oct 2024 – Present`) is a row of
  badges: the first in ink, a span that runs until now with a live dot. Code
  blocks have a bar with the language, the line count, `wrap`, `copy`; a long
  block is folded to 22 lines. Every block, heading and table row has a
  stable id: an address with a hash goes there and pings it.
- **Tables.** A card with a key column, a sticky header when the table fits,
  sideways scroll with a sticky key column when it does not. A filter field
  on tables with 8 or more rows. A light follows the pointer along a row. The
  `#` button of a row copies its link. `copy` gives the visible rows as
  Markdown or TSV. In a narrow column every row is a stacked card.
- **Panel** (desktop). The logo as a 3D relief, traced from `logo.png`; it
  links home. The pointer is a torch: the bevels catch its light, the strokes
  cast shadows into its pool of haze, and the relief turns a little towards
  it. Once the page's rain is gone the relief builds itself out of scrambled
  characters, and a ring of them runs through it from where the pointer comes
  on (the glyph storm, below). Without WebGL it is the ASCII logo. The section list with minutes, a ring that fills as the reader reads,
  a dot on sections that changed since the last visit, and a rail on the
  current one. Comfort: vibe, text size S/M/L, motion full/calm, and
  `clear my data on this device`.
- **Map** (desktop). A 28 px strip between the document and the panel: one bar
  per block, ticks for section starts, search hits and echo hits. Read blocks
  are toned. A window follows the scroll. Click or drag to scrub; arrow keys,
  Page Up/Down, Home and End work on it.
- **Dock.** Desktop: a pill at the bottom of the document column with search,
  ruler, torch, lights out, the read percent and the key map. It hides on scroll down
  and returns on scroll up; it never hides with less motion. Phone: a bottom
  bar with the read ring, the current section (tap opens the sheet) and
  search. The sheet holds the tools, the section list and Comfort.
- **Progress line.** A 2 px line at the top, by scroll.
- **Resume.** On a fresh load without a hash, when the last reading place is
  deep enough: `you left the light on in {section}.` with `pick up` and
  `start over`. It leaves after the first scroll.
- **Search** (`⌘K` or `/`). Blocks, rows and list items that contain every
  word, ranked: headings, then phrase, then reading order. Grouped by
  section, with the hit marked. Arrow keys peek: the page scrolls behind the
  dialog to the result. `Enter` goes there and pings it. `Escape` returns to
  where the reader was. With several documents, search goes through all of
  them: hits in the open document first, then up to 3 hits from each other
  document under its title; picking one opens that document at the hit.
  Empty search lists the sections and the other documents. Typing `>` lists
  commands: vibes, text size, motion,
  ruler, torch, lights out, keys, clear data; next / previous section, back
  to the top; copy this section as Markdown, copy the link to this section.
- **Searchlight** (`⇧↵` in search). The page dims and every hit glows. A bar
  shows `12 lit · n / N step · esc lights on`.
- **Echo.** A click on inline code, or `e`, lights every place the term
  appears and opens a card: the count, the sections with counts (click
  jumps), previous and next, `copy`.
- **Ruler** (`L`). A reading band follows the pointer; the rest dims. `J` and
  `K` step it block by block, and row by row inside tall tables and lists.
- **Torch** (`F`, or the torch button in the dock and the sheet). Reading by
  torchlight: the page goes dark and a soft beam follows the pointer, with the
  same core and falloff as the Enter page beam and a haze in the colour of the
  light. `+` and `-` change its size (0.6 to 1.6). Without a pointer it rests
  on the reading line; on touch it follows the finger and returns to the line
  1.2 s after it lifts. It moves to every pinged target. It opens like an iris
  (instant with less motion), never blocks a click or a scroll, and steps
  aside while a dialog is open. Torch and ruler exclude each other.
- **Section hops.** `]` next section, `[` previous section (from the middle
  of a section, its start first), `T` back to the top.
- **Lights out** (`B`). A black screen with the beam in it, the tab title
  swapped and the page inert. Any key or click comes back.
- **Away title.** While the reader is in another tab, the tab title reads
  `the light's still on.` It comes back on return.
- **The ping.** The one attention effect: a ring that expands from the
  target and fades in 900 ms. Search jumps, hash targets, echo and searchlight
  steps and resume use it.

### Easter eggs (spoilers)

Found, not announced. None of them stands between the reader and `ENTER`.

- **Dead battery** (Enter page). Six clicks in the dark within 2 s, on
  nothing: the beam sputters, goes out for 2 s (`battery's dead.`), then comes
  back (`and we're back.`). With the spare battery found, the outage is cut
  short: `swapped the battery.` and an over-bright pulse. Dips stay at 3 per
  second or fewer. With less motion: a plain fade out and back.
- **The moth.** Once found, it leaves its plate and circles the beam: on the
  Enter page and in lights out. With less motion it sits still beside the
  beam.
- **Night shift.** From 00:00 to 05:00 local time, the first Enter page hint
  is `late shift. the light's on.` for 9 s.
- **SOS.** 45 s on the Enter page with no input at all: the sweeping beam
  blinks `· · · — — — · · ·` once per load. Power dips to 0.15, never to 0.
  Not with less motion.
- **The ink remembers.** With the whole document read (100 %), the wordmark
  keeps a faint glow in the dark and the hint reads
  `you've been everywhere. the ink remembers.`
- **The wiring.** The devtools console greets engineers and offers
  `lights.off()`, `lights.on()` (lights out, on the content page) and
  `lights.vibe("sodium")` (any unlocked vibe). It never prints document text.

On the keyboard, the key hint wins over the night and the 100 % hints.

### Keys

The key map (`?`) lists the live set. Keys never fire while the reader types
in a field, and a key that belongs to a focused button stays with it. Letter,
digit and bracket keys also work on other layouts (Ukrainian `х` is `[`): when
the typed character is not Latin, the physical key decides.

| Key              | Where                        | Does                                                                                                         |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `←` `↑` `→` `↓`  | Enter page                   | Aim the beam 48 px. With `Shift`: 160 px.                                                                    |
| `Enter`          | Enter page                   | Collect the lit object, or open. During the show: skip.                                                      |
| `Escape`         | Enter page, during show      | Skip to the library.                                                                                         |
| `1` `2` `3` `4`  | Enter page                   | Vibe: ultraviolet, phosphor, sodium, cryo (if found).                                                        |
| wheel            | Enter page                   | Beam size, 0.6 to 1.6.                                                                                       |
| `⌘K` (`ctrl K`)  | content page, also in search | Open or close search.                                                                                        |
| `/`              | content page                 | Open search.                                                                                                 |
| `↑` `↓` `↵` `⇧↵` | in search                    | Peek, go, searchlight.                                                                                       |
| `n` / `N`        | searchlight on               | Next / previous hit, with a ping.                                                                            |
| `e`              | content page                 | Echo the first code term of the current block; again for the next.                                           |
| `L`              | content page                 | Ruler on or off.                                                                                             |
| `J` / `K`        | ruler on                     | Ruler to the next / previous block.                                                                          |
| `F`              | content page                 | Torch on or off.                                                                                             |
| `+` `=` / `-`    | torch on                     | A wider / narrower beam.                                                                                     |
| `]` / `[`        | content page                 | Next / previous section, with a ping.                                                                        |
| `T`              | content page                 | Back to the top.                                                                                             |
| `B`              | content page                 | Lights out. Any key comes back.                                                                              |
| `?`              | content page                 | Key map.                                                                                                     |
| `Enter`          | resume card shown            | Pick up.                                                                                                     |
| `Escape`         | content page                 | One thing at a time: the open dialog, then the echo, the searchlight, the torch, the ruler, the resume card. |

## Preferences and privacy

The document can be confidential. The site makes no network call to a third
party: no analytics, no CDN. Fonts are bundled npm packages
(`@fontsource-variable/*`).

`localStorage` holds one key, `mf:v1`, written only through `prefs.ts`. It is
validated on every read; a broken value falls back to the defaults.

| Field     | Holds                                                                |
| --------- | -------------------------------------------------------------------- |
| `vibe`    | `ultraviolet`, `phosphor`, `sodium` or `cryo`                        |
| `size`    | `s`, `m` or `l` (root font size 93.75 %, 100 %, 112.5 %)             |
| `motion`  | `full` or `calm`                                                     |
| `seen`    | `true` after the first `ENTER`: the fast lane                        |
| `found`   | Ids of the objects found on the Enter page (`moth` ...)              |
| `doc`     | Slug of the open document, or of the last one: `continue` goes there |
| `read`    | Ids of the blocks the reader dwelt on (`b-` + hash)                  |
| `last`    | Block id of the last reading position                                |
| `percent` | 0..100, the read share, for the `continue` button                    |
| `hashes`  | Hash of each section id mapped to the hash of its text               |
| `shelf`   | Slug -> `read`, `last`, `percent`, `hashes` of every other document  |

- `read`, `last`, `percent` and `hashes` belong to the document in `doc`. To
  open another document, `openDoc` puts them on the `shelf` and takes that
  document's off it. Progress stored before there were several documents
  (no `doc`) goes to the first document opened.

- Never document text and never search queries. A section id is a heading
  slug, so it is stored as a hash. The searchlight query lives in memory only.
- A block counts as read when it stays in the middle of the viewport for a
  dwell time that grows with its words (at least 1.2 s). Scrolling past does
  not count.
- `clear my data on this device` removes the key. In Comfort it asks first;
  in search it is the `>` command of that name.
- An inline script in `<head>` (`PREFS_BOOT_SCRIPT`) sets `data-vibe`,
  `data-size` and `data-motion` on `<html>` before the first paint. A change in
  another tab is applied through the `storage` event.

## Look

- Light is the only material. No glass (the pods of the library room are the
  one exception), no gradients behind text, no glow on text the reader reads. Body text is neutral in every vibe; the accent
  colours structure only: chips, rails, focus, the current item, marks.
- Fonts: Anybody (display, its weight and width axes bound to light on the
  Enter page), Instrument Sans (body), JetBrains Mono (code, chips, counters).
- A vibe is a light source. `html[data-vibe]` selects the CSS half
  (`tokens.css`); `vibes.ts` holds the rain palette and the `theme-color`.
  `setVibe` spreads the new light as a circle from the control that chose it
  (View Transitions; a plain cut without them or with less motion).
- Less motion: the system setting `prefers-reduced-motion` and the `calm`
  preference get the same treatment. Every stylesheet handles both. Nothing
  slides in; things get lit in 120 to 240 ms.
- Every control is reachable by keyboard, has a 2 px focus ring and a name.
  Touch targets are at least 44 px. Below `60rem` the page is one column: the
  panel and the map are hidden, and the dock is a bottom bar that respects
  the safe area.

## Code map

| File                                  | Role                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/matrix-flashlight.ts`        | Canvas engine: rain, beam, sweep, flood, drain, palette. No React.                                                       |
| `src/lib/use-scramble.ts`             | Hook and pure frame function: text that decodes out of random glyphs.                                                    |
| `src/lib/markdown.ts`                 | Parses Markdown into blocks with stable ids, nav sections and stats.                                                     |
| `src/lib/hash.ts`                     | FNV-1a: names blocks, rows and section versions.                                                                         |
| `src/lib/prefs.ts`                    | The reader's choices and reading state in `localStorage` (`mf:v1`).                                                      |
| `src/lib/vibes.ts`                    | The four vibes: rain palettes, `setVibe` with the circle reveal.                                                         |
| `src/lib/reading.ts`                  | Current section and block, scroll progress, read marks, what changed.                                                    |
| `src/lib/ui.ts`                       | In-memory state: the open overlay (one at a time), ruler, torch, echo, searchlight.                                      |
| `src/lib/hotkeys.ts`                  | One `keydown` listener for every shortcut, with a physical-key fallback.                                                 |
| `src/lib/console.ts`                  | The devtools greeting and `window.lights`.                                                                               |
| `src/lib/jump.ts`                     | Instant jump to a target, the ping, links, copy to clipboard.                                                            |
| `src/lib/highlight.ts`                | CSS Custom Highlight API: marks text without touching the DOM.                                                           |
| `src/lib/search.ts`                   | The search index and ranking. Pure.                                                                                      |
| `src/lib/toast.ts`                    | One short message at a time.                                                                                             |
| `src/lib/copy.ts`                     | Every string a reader sees.                                                                                              |
| `src/lib/reduced-motion.ts`           | Less motion: the system setting or the "calm" preference.                                                                |
| `src/lib/ascii-art.ts`                | Converts an image to ASCII art of solid characters; the glyph ramp the 3D logo's storm shares.                           |
| `src/lib/logo-trace.ts`               | Traces the ink of a picture into shapes with holes (marching squares). Pure.                                             |
| `src/lib/logo-stage.ts`               | The 3D logo (Three.js): extruded strokes, the torch, tilt, the glyph storm pass. No React.                               |
| `src/lib/glyph-storm.ts`              | The glyph storm: a ring of scrambled characters that decodes or shivers the ASCII art. No DOM.                           |
| `src/lib/content.ts`                  | Loads and parses every `src/content/*.md`: the library. Its own chunk.                                                   |
| `src/lib/shelf.ts`                    | File names, slugs and order of the documents, without their text. The Enter page uses it.                                |
| `src/lib/site.ts`                     | Reads `src/content/site.json` (the wordmark). Small: the Enter page uses it.                                             |
| `src/components/MatrixFlashlight.tsx` | Enter page: engine, the deep, lit targets, wordmark, objects, loader, vibe dots.                                         |
| `src/components/ContentPage.tsx`      | Content page of one document: opens it, composes the parts, rain intro, hash arrival.                                    |
| `src/components/Library.tsx`          | The library page: one card per document, the beam on the cards.                                                          |
| `src/components/TubeStage.tsx`        | Mounts the 3D room behind the library; loads `three` only there.                                                         |
| `src/lib/tube-stage.ts`               | The 3D room (Three.js): pods, rain in depth, beam, floor, orbit, bullet time. No React.                                  |
| `src/components/BulletTime.tsx`       | Mounts bullet time round the poster title once the page's rain has gone; loads `three` only there.                       |
| `src/components/WaterStage.tsx`       | Mounts the water under the next card once the page's rain has gone; loads `three` only there.                            |
| `src/lib/water-stage.ts`              | The water (Three.js): the card painted and reflected, wind, rain drops, the wake. No React.                              |
| `src/lib/bullet-time.ts`              | Bullet time (Three.js): frozen rain in depth, bullets with tracers and air rings, the time ramp, the orbit. No React.    |
| `src/lib/deep-rain.ts`                | The deep under the Enter page (Three.js): deep rain in the beam, the shaft and its dust, the dive. No React.             |
| `src/lib/three-ink.ts`                | What the Three.js layers share: additive light, the glyph atlas, colours, easing.                                        |
| `src/lib/code-tiles.ts`               | Seamless tiles of falling glyphs per ink: the code inside the letters of the Enter page.                                 |
| `src/components/Shelf.tsx`            | The way between documents on a content page: the shelf row and the next card.                                            |
| `src/components/Markdown.tsx`         | Renders the blocks: one `.doc__block` wrapper with the block id each.                                                    |
| `src/components/Inline.tsx`           | Renders inline Markdown. Inline code carries `data-echo`.                                                                |
| `src/components/DocHeader.tsx`        | The title block: poster title and stats chips.                                                                           |
| `src/components/DocTable.tsx`         | A table: key column, filter, row light, row links, copy menu.                                                            |
| `src/components/CodeBlock.tsx`        | A fenced code block: bar, fold, wrap, copy.                                                                              |
| `src/components/Panel.tsx`            | The sticky panel: logo, navigation, Comfort.                                                                             |
| `src/components/LogoStage.tsx`        | Mounts the 3D logo; loads `three` only there. Falls back to `AsciiImage`.                                                |
| `src/components/SectionNav.tsx`       | The navigation (panel and sheet): read rings, changed dots, current.                                                     |
| `src/components/Comfort.tsx`          | Vibe, text size, motion, clear my data.                                                                                  |
| `src/components/AsciiImage.tsx`       | Renders an image as ASCII art, with the local beam and the glyph storm. The logo without WebGL.                          |
| `src/components/Minimap.tsx`          | The map of the document: SVG strip, window, hits, scrub.                                                                 |
| `src/components/ProgressLine.tsx`     | The 2 px progress line.                                                                                                  |
| `src/components/Dock.tsx`             | The dock (desktop pill, phone bottom bar) and the read ring.                                                             |
| `src/components/Sheet.tsx`            | The phone sheet: tools, section list, Comfort.                                                                           |
| `src/components/Keymap.tsx`           | The key map dialog, and the shared dialog hook and keycaps.                                                              |
| `src/components/Resume.tsx`           | The "you left the light on" card.                                                                                        |
| `src/components/Spotlight.tsx`        | Search dialog, peek, commands, and the searchlight bar.                                                                  |
| `src/components/Echo.tsx`             | Echo: highlight of a code term and its card.                                                                             |
| `src/components/Ruler.tsx`            | The reading ruler.                                                                                                       |
| `src/components/Curtain.tsx`          | Lights out.                                                                                                              |
| `src/components/Torch.tsx`            | Reading by torchlight.                                                                                                   |
| `src/components/Moth.tsx`             | The moth that circles the beam once found.                                                                               |
| `src/components/Toast.tsx`            | The live region that shows `toast()` messages (a top-layer popover).                                                     |
| `src/styles.css`                      | Only the `@import` list of `src/styles/*.css`, in cascade order.                                                         |
| `src/styles/tokens.css`               | Fonts, tokens, vibes, base rules, page grid, ping, highlights, toast.                                                    |
| `src/styles/enter.css`                | The Enter page.                                                                                                          |
| `src/styles/doc.css`                  | The document.                                                                                                            |
| `src/styles/table.css`                | Tables.                                                                                                                  |
| `src/styles/panel.css`                | Panel, its logo (3D canvas; ASCII beam and glyph storm sparks), section list, Comfort.                                   |
| `src/styles/dock.css`                 | Progress line, dock, sheet, key map, resume.                                                                             |
| `src/styles/spotlight.css`            | Search dialog and searchlight.                                                                                           |
| `src/styles/tools.css`                | Echo, ruler, lights out.                                                                                                 |
| `src/styles/minimap.css`              | The map.                                                                                                                 |
| `src/styles/torch.css`                | The torch.                                                                                                               |
| `src/styles/moth.css`                 | The moth.                                                                                                                |
| `src/styles/library.css`              | The library, its 3D room canvas, and the way between documents.                                                          |
| `src/styles/bullet-time.css`          | The canvas of bullet time, behind the document.                                                                          |
| `src/styles/water.css`                | The canvas of the water, behind the document.                                                                            |
| `src/styles/print.css`                | Print: light paper, black ink, no chrome, rows kept whole.                                                               |
| `src/routes/`                         | File-based routes: `index.tsx` (`/`), `content.index.tsx` (the library), `content.$slug.tsx` (a document), `__root.tsx`. |
| `vite.config.ts`                      | Vite+ config. `spa.enabled` turns on SPA mode.                                                                           |

The Enter route does not import `src/lib/content`: the documents are their own
chunk, loaded when `ENTER` preloads `/content/<slug>`.

## How the engine works

`src/lib/matrix-flashlight.ts` draws on one canvas. React only mounts it.

- The rain is simulated for the whole viewport. A glyph is drawn only when the
  beam reaches its cell, so everything else stays pure black. Each cell is one
  `drawImage` from a prerendered glyph atlas.
- Palette: the engine takes its inks from a `RainPalette` (`vibes.ts`):
  `trail`, `head`, `alt`, `fringe`, and the haze colours. `setPalette` rebuilds
  the atlas when the vibe changes, while the rain falls.
- Duotone: every 5th stream uses the `alt` ink.
- Fringe: cells in the soft edge of the beam (falloff below 0.45) use the
  `fringe` ink, so the beam has a chromatic edge. A haze in the colour of the
  light sits under the glyphs.
- Each frame the engine reports the beam (`onLight`). The Enter page turns it
  into `--lit` on every `[data-lit]` element, written on that element only.
- Sweep: with no pointer (before the first one, and 2.5 s after it leaves),
  the beam drifts on a slow Lissajous path that crosses the pill.
- Steering: `aim(x, y)` and `nudge(dx, dy)` move the beam from the keyboard;
  `setScale` sets its size (0.6 to 1.6).
- Pace: `setPace(p)` sets how fast the rain falls against its natural pace;
  the rain eases to it. `onLight` reports the pace shown (`light.pace`), so
  the deep and the code in the letters keep the same time.
- Linger: on touch the light stays 1.2 s after the finger lifts.
- Parked beam: with less motion there is no sweep. The beam rests on the
  centre at full power, and the rain is slower and does not flicker.
- Flood: the beam grows until its fully lit core covers the whole viewport.
- Drain: streams stop respawning and speed up. When the last one has left the
  screen, the engine calls back and the content page removes the canvas.
- Signals: `signal(steps)` plays a power envelope that the tick multiplies
  into the beam's power (`PowerStep`: a level, a duration, an optional cue).
  `outage()` builds the dead battery and `morse()` the SOS; both stay at 3
  dips per second or fewer. A level above 1 is the over-bright pulse.
  `isSweeping()` tells the page the beam is drifting on its own.
- Afterglow: `afterglow()` lets a lit value fall with a half-life instead of
  at once. The Enter page uses it for the wordmark.
- The same engine runs in lights out (beam mode, with the sweep).
- The deep (`src/lib/deep-rain.ts`) has no loop of its own: `onLight` draws it
  once per engine frame, so both layers agree on the beam. Its fragments take
  the same falloff (`BEAM_CORE`) from the beam in device pixels. The 3D
  streams wrap in depth, so the dive can fall for as long as the show lasts.

## Tests

`vp test run` runs behaviour tests of the pure modules. They test logic that
can really fail; there are no tests of markup, constants or mocks.

| File                                      | Covers                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `src/lib/markdown.test.ts`                | Block ids, sections, lifted codes, stats, duplicate slugs, meta lines.    |
| `src/lib/prefs.test.ts`                   | Validation and updates of the stored preferences; progress per document.  |
| `src/lib/shelf.test.ts`                   | Order of the documents and their slugs.                                   |
| `src/lib/search.test.ts`                  | Matching, ranking, snippets.                                              |
| `src/lib/ascii-art.test.ts`               | Fitting the logo columns to the width.                                    |
| `src/lib/glyph-storm.test.ts`             | The storm keeps the outline and lines; reveal and ripple timing.          |
| `src/lib/logo-trace.test.ts`              | Tracing: pieces, holes, islands, round edges, edges of the image, specks. |
| `src/lib/use-scramble.test.ts`            | Frames of the scramble.                                                   |
| `src/lib/site.test.ts`                    | Splitting the wordmark into rows.                                         |
| `src/lib/matrix-flashlight.test.ts`       | Afterglow, power signals, Morse, flash rate, outages.                     |
| `src/lib/tube-stage.test.ts`              | Where the 3D shelf stands, its width, parallax, colour tokens.            |
| `src/lib/hotkeys.test.ts`                 | Matching shortcuts, the physical-key fallback.                            |
| `src/lib/ui.test.ts`                      | Torch and ruler exclude each other.                                       |
| `src/lib/console.test.ts`                 | `window.lights` answers.                                                  |
| `src/components/MatrixFlashlight.test.ts` | The click burst that kills the battery.                                   |
| `src/components/Spotlight.test.ts`        | Section hops and the section as Markdown.                                 |
| `src/components/Markdown.test.ts`         | The code chip of a heading: what is lifted, what stays.                   |
| `src/components/DocTable.test.ts`         | Row ids, key column detection, filter, Markdown and TSV.                  |
| `src/components/SectionNav.test.ts`       | The outline of parts and sections.                                        |
| `src/components/Dock.test.ts`             | When the dock hides and returns.                                          |
| `src/components/Keymap.test.ts`           | Grouping of the hotkeys.                                                  |
| `src/components/Echo.test.ts`             | Card placement, section tallies, the next term.                           |
| `src/components/Ruler.test.ts`            | Stepping block by block.                                                  |
| `src/components/Minimap.test.ts`          | Geometry, scrub, keys, hits, sections.                                    |

## How the 3D logo works

`src/lib/logo-trace.ts` and `src/lib/logo-stage.ts` turn `logo.png` into a
relief. Nothing about the logo is hard-coded: a new `logo.png` is traced the
same way.

- **Trace.** The picture is drawn at 640 px on its long side. A cut-out PNG is
  inked by its alpha; an opaque one by how far each pixel's brightness is
  from that of its corners. Marching squares find the outlines between pixel centres,
  Ramer–Douglas–Peucker thins them to 0.35 px, and nesting sorts them into
  shapes and holes. Specks under 16 px² are dropped.
- **Relief.** Every shape is its own extruded stroke. Its walls stand on the
  traced outline; the bevel eats into the face, so the silhouette stays the
  picture's own. Normals are smoothed across folds flatter than about 35°.
- **Rest.** The ink glows dimly, faces brighter than walls. A dark studio of
  bright cards (PMREM) gives the bevels and the clear coat their highlights.
  No light falls on the panel at rest.
- **Torch.** A spot light rides over the pointer: white, tinted with the ink
  of the vibe. Its pool on the panel is the vibe's haze, with the strokes'
  shadows cut out of it. The canvas reaches past the logo into its corner of
  the panel, so the pool stays round and fades out before any edge. The relief turns towards the pointer and the
  camera drifts against it. Keyboard focus, or a hover with less motion, lights
  the whole logo with a fainter pool.
- **Glyph storm.** The same reveal and ripple as the ASCII logo, in 3D. Once
  the page's rain is gone, a ring runs out from the centre: past it nothing is
  drawn, on it the relief is glyphs of the ASCII ramp (denser where brighter,
  scrambled), inside it the strokes spring up. A pointer that comes on starts
  a thinner ring that lifts the strokes as it passes; none within 1.4 s. The
  cells are as many and as big as the ASCII logo's (`LOGO_COLUMNS`,
  `fitColumns`).
- **Cost.** Frames run only while something moves; the tab in the background
  stops them. DPR is capped at 2. Everything is disposed on unmount.
- With less motion there is no tilt, no reveal and no ripple.
- Without WebGL, or with no ink to trace, `LogoStage` shows `AsciiImage`.

## How the ASCII logo works (without WebGL)

`src/lib/ascii-art.ts` builds the art from solid characters only.

- The image is cut into cells, one per character.
- A cell that the image covers less than half stays empty. So an edge is a
  clean cut, with no stroke drawn along it.
- Every other cell gets one character by tone: a light area gets a dense
  character, a dark area a sparse one.
- The characters are round or dense letters, digits and a few symbols
  (`SOLID_GLYPHS`). There are no line-like characters: no `/`, `_`, `|` or
  quotes, and no thin letters such as `i`, `l`, `J`. The font decides their
  order: each one is drawn and its ink is measured.
- Auto-levels stretch the image's own darkest and lightest tones over the
  whole range of characters, so close tones get different characters.
- `LOGO_COLUMNS` in `Panel.tsx` sets the most detail. More columns show more
  detail in smaller characters. `fitColumns` lowers the count when the panel
  is too narrow for readable characters, so the art always fills the width.
- `AsciiImage` waits for the fonts before it measures the characters.

### The glyph storm

`src/lib/glyph-storm.ts` runs a ring of scrambled characters across the art.

- **Reveal.** The first time an image's art shows, it decodes from the centre
  out: inside the ring the art is settled, on it the characters scramble, past
  it nothing is drawn yet. A resize draws new art but does not reveal it again;
  a new `logo.png` does.
- **Ripple.** When the pointer comes onto the art, a thinner ring runs out from
  that point and the art shivers once. A pointer that comes back within
  1.4 s starts none.
- Only cells with ink take part, so the outline never changes. The size,
  speed and width of the ring come from the art itself, so any logo, of any
  shape and column count, gets the same feel.
- The scrambled characters are drawn in a third layer (`.ascii__spark`), hot
  with a glow; the art and the beam copy show spaces there. The text nodes are
  written once per frame, never through React state.
- With less motion there is no storm.
