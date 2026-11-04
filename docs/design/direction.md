# EqDownload visual direction

The look of the app UI (`ui/`), shared by the Windows shell and the Android WebView. Dealt with the
taste skill (`design-taste-frontend`). UX rules came from UI/UX Pro Max. Dated 2026-11-04.

## The deal

- Command: `draw.mjs --sector consumer-app --brief "EqDownload: a private desktop and Android app that saves a video or its audio from a pasted link, with yt-dlp as the engine" --sections list,how-it-works --have product-ui --options 3`.
  The brief asked for `--sector tools`. That sector does not exist (`draw.mjs --list sectors`), so
  `consumer-app` was the closest.
- Dealt: `loud-flat-poster`, `name-as-monument`, `page-is-the-object`.
- **Chosen: `name-as-monument`, seed `376266133`.** Reprint it with `draw.mjs --show`; the saved copy is
  in `.taste-skill/direction.json`, which git ignores.
- Why this one: the inventory's strongest item is the name. "Eq" reads as the equals sign. A
  direction built on treating the name's letters as material can carry that. `page-is-the-object`
  needed a printed artefact. The only one this subject has is yt-dlp's console progress line, and
  that is monospace, which the house rules ban. `loud-flat-poster` wants short statements, and a
  utility has nothing to proclaim.
- Sheet: hero "Film title, bottom edge"; type **Unbounded / Onest**; palette **Bottle green, gold**;
  sections "One item per poster line" (list) and "Run-in column" (how-it-works); motion "Slow
  crossfade"; photographs "Architecture" set.
- No slot was redrawn. The parts of the sheet that cannot apply to an app, and what took their place:
  - *Hero photograph, slow crossfade, Architecture photographs.* The app has no photographs, and the
    only picture it ever shows is the video's own thumbnail. The signature move is the equals meter
    (below). No stock photograph stands in for anything.
  - *Hero anchored to the bottom edge.* Each screen's name is the monument, but at the top. It
    spans the width, and the controls sit below it, where the hand and the eye are.
  - *List blueprint* became Library: one finished file per line, the title large, its fact (the
    path) beneath it, the one action at the right.
  - *Run-in column* became Settings: one column starting at the 4th of 12 columns. Each setting
    opens with its name as a run-in in weight 500.
  - The name comes back at full width in the footer, in the inverse colours, as the sheet asks. It
    carries the privacy promise.

## Inventory (things only this subject has)

1. The name, EqDownload: "Eq" is an equals sign.
2. The owner's handle, EQQX0.
3. The engine, yt-dlp, whose version number is a date (2025.10.22).
4. Five presets: Best, 1080p, 720p, Audio MP3, Audio M4A.
5. The live numbers yt-dlp reports: percent, speed, ETA.
6. The constraint: nothing leaves the app except to the site you paste and, on a button press, GitHub.
7. No accounts, no analytics, no ads.
8. The input: one pasted or shared link.
9. The output: a file on disk, named after the video, with the preset's extension.
10. The destination folder, usually Downloads.
11. Its failures: unsupported site, login/age/region block, no network, out-of-date engine, full disk.
12. Two homes: a portable Windows exe and an Android APK.

## The idea

> In EqDownload, **the equals sign in its name** becomes **the progress meter**: two flat bars, the
> upper one the original, the lower one the copy on disk, filling until the two are equal.

- **Competitor test.** "In 4K Video Downloader, the equals sign in its name becomes the meter" does
  not work: no other downloader has the sign in its name. The idea belongs to this subject. **Pass.**
- **The live thing** is the meter on Downloads. It runs on the real numbers. When a job is done,
  its two bars read as "=". A failed or cancelled job keeps both bars in the muted ink and says
  Failed or Cancelled in words. The same two bars are the emblem in the header, the Done mark in
  Library, the app icon (`design/icon.svg`), and the bar under the current tab and the chosen preset.
- On a phone it is the same meter at full width. The percent sits beside it in the display face.
  Without motion the bar simply stands at its value.

## Tokens

All colours are in `ui/src/styles/tokens.css`. They use `light-dark()` and switch on
`prefers-color-scheme`. Dark is the dealt sheet. Light swaps the proportions: a pale sage ground
with green ink. Gold stays on the action's text and on the inverse footer. Neither scheme uses a
banned family (cream, terracotta, violet).

| Role | Light | Dark |
| --- | --- | --- |
| `--bg` ground | `#eef0ea` | `#133621` |
| `--surface` fields, buttons, panels | `#dfe5dc` | `#1a4429` |
| `--surface-press` pressed / selected | `#d0d9cc` | `#22553a` |
| `--ink` text and marks | `#133621` | `#f4d96c` |
| `--muted` secondary text | `#33503c` | `#d4c77c` |
| `--track` empty part of the meter | `#c3cfbf` | `#2b5e3c` |
| `--accent` / `--accent-ink` the Download button | `#133621` / `#f4d96c` | `#f4d96c` / `#133621` |
| `--inverse` / `--inverse-ink` footer | `#133621` / `#f4d96c` | `#f4d96c` / `#133621` |

Contrast, computed with the WCAG formula (body text needs 4.5:1):

| Pair | Light | Dark |
| --- | --- | --- |
| ink on ground | 11.59 | 9.50 |
| ink on surface | 10.38 | 7.88 |
| ink on pressed surface | 9.18 | 6.17 |
| muted on ground | 7.77 | 7.77 |
| muted on surface (placeholder) | 6.96 | 6.44 |
| accent-ink on accent (Download) | 9.50 | 9.50 |
| Check link (ground on ink) | 11.59 | 9.50 |
| inverse-ink on inverse (footer) | 9.50 | 9.50 |
| meter fill on track (non-text, needs 3:1) | 8.24 | 5.41 |
| failed fill (muted) on track | 5.52 | 4.43 |

The track itself is 1.41:1 (light) and 1.76:1 (dark) against the ground. That is deliberate: it is
the empty half of a bar, not a boundary that carries information. The value is carried by the fill,
by the percent text and by the hidden native `<progress>`.

**Type.** Two faces, five sizes:

| Step | Size | Use |
| --- | --- | --- |
| `--step-monument` | clamp(36px, 10.4vw, 184px) | screen names (Unbounded 800, uppercase, -0.045em, leading 0.92); the footer name at min(9.4vw, 168px) |
| `--step-head` | 32-64px | short video titles, percent numerals (Unbounded 800) |
| `--step-lead` | 20-26px | intro line, long titles, error text, the Download button |
| `--step-body` | 17-19px | running text, controls (Onest 400/500) |
| `--step-small` | 14-15px | defined for captions; no text uses it in the current screens |

Video titles are as long as the site makes them. The title's length sets its step: up to 40
characters takes head, up to 90 takes lead, and longer takes body. Every title is clamped to two
lines, and the full text is in its `title` attribute.

**Space.** Margins clamp(16px, 2.2vw, 32px) plus the safe-area insets. Gutter clamp(16px, 2vw,
32px). Spacing steps are 8, 16, 24, 32, 48 and 80px. A meter bar is 12px thick. Touch targets are
44px minimum, and 48px on `pointer: coarse`; the main buttons are 56px. Corners are square
everywhere. There are no shadows, gradients or hairlines. Surfaces differ by one tone step; the
field and the error box carry a thick ink bar.

**Motion** (`ui/src/styles/motion.css`, `ui/src/lib/meter.ts`). Transform and opacity only:

- The meter fill moves through the Web Animations API, so no `style` attribute is written. It takes
  700ms with ease-out, starting from the bar's current position.
- A new job draws its upper bar first.
- Each screen name rises out of its own baseline (a masked line). The parts of the screen follow in
  reading order, 60-90ms apart. Lists arrive row by row.
- The emblem draws its two bars on load.
- Every control responds to press (scale 0.97), hover (one tone step, behind `hover: hover`) and
  focus (a 3px ink ring, offset 3px).
- Under `prefers-reduced-motion: reduce`, travel is dropped. Only 200ms fades remain, and the meter
  jumps straight to its value.
- Every screen is rendered by script, so nothing waits on a script-set class. All the animations
  are plain CSS with `both` fill and always end visible.

## Fonts and licences

The fonts are self-hosted: woff2 files in `ui/src/assets/fonts/`, which Vite emits beside the
bundle. Only the Latin and Latin Extended subsets are included. Titles in other scripts fall back
to the system sans. The licence texts ship in `ui/public/fonts/` and are copied to `dist/fonts/`.

| Face | Weights | Licence | Source |
| --- | --- | --- | --- |
| Unbounded | 800 | SIL Open Font License 1.1, (c) 2022 The Unbounded Project Authors | `@fontsource/unbounded` 5.3.0 |
| Onest | 400, 500 | SIL Open Font License 1.1, (c) 2021 The Onest Project Authors | `@fontsource/onest` 5.3.1 |

**CSP.** The policy has no `font-src`, so fonts fall back to `default-src 'self'`. That covers them
over http (Vite) and over `file://` (Electron `loadFile`). The packaged UI was checked in Electron
under the production CSP header. Unbounded 800, Onest 400 and Onest 500 all report `loaded`, with
no CSP message other than the existing `frame-ancestors`-in-meta notice. **No CSP change was
needed.** There is no Google Fonts request, no remote CSS and no inline script.

## Inspector waivers

These rules exist for marketing pages. Each is waived with `--allow` for one stated reason:

| Rule | Why it does not apply to this app |
| --- | --- |
| `few-pictures` (FAIL) | The floor of four real pictures is for a page that sells a place or product. An app screen shows the user's own content. The one real picture this UI ever has is the probed video's thumbnail, and it is shown large. Adding stock or archive photographs to a downloader would be decoration, and every photograph would also be a network or bundle cost. |
| `no-real-pictures` (WARN) | Same reason as `few-pictures`. |
| `no-footage` (WARN) | The app plays no video. A looping clip in a utility costs CPU and battery and has nothing to show. |

Kept as a WARN and defended rather than waived:

- **`still-page`** (WARN; 11-12 moving elements against a target of 16). The 8-element floor is
  met on every screen. The rest of the target asks for marketing choreography. The UI/UX Pro Max
  rule "Excessive Motion" asks an app view to animate one or two key elements. Here every screen
  moves its name, its parts in order, and its controls on press, and Downloads has the live meter.
  More motion on screens a user opens dozens of times a day would be noise.

Lint WARNs, defended:

- **`numbering`**: `padStart(2, '0')` in `lib/format.ts` formats the ETA clock (`0:38`). It is not
  an index label.
- **`em-dash`**: the five dashes are the "value unknown" placeholder in `lib/format.ts` and its unit
  tests. They are not prose.

These ornament rules hold in full: no eyebrows, no monospace, no index numbers, no thin rules, no
gradients, no shadows at rest, no glass, no emoji, no icon-topped card rows, no tiny tracked capitals,
no styled accent words, two typefaces.

## UI/UX Pro Max

- `search.py "utility video downloader app" --design-system` returned a landing-page system: hero
  plus testimonials, rose and orange, Inter with Playfair. It does not fit an app with no social
  proof, and it conflicts with the dealt direction. Its palette and fonts were not used.
- The `--domain ux` results were applied:
  - Touch targets of 44px, or 48 on coarse pointers, with an 8px gap.
  - A visible label on the link field. The field is described by the hint and by the error text
    (`aria-describedby`).
  - Feedback while checking a link: the status line plus `aria-busy`.
  - Errors keep `role="alert"`.
  - The focus ring is never removed, and no sticky bar covers it: the phone tabs sit in the flow,
    not fixed over content.
  - Reduced motion is honoured.
- Pre-delivery checklist: see the task report (`.superpowers/sdd/2026-11-04-eqdownload/task-6-report.md`).

## Look-and-fix results

Screens are driven with a scripted engine by `.taste-skill/capture.mjs`. The states are Home
empty, Home with a probed link and thumbnail, Home with an error, Downloads (running at 45%, a
network failure with Retry, a finished job, and an outdated-engine failure that raises the error
box), Library with three files, and Settings. Each state is captured in light and dark at 1440,
768 and 390px. For every state and scheme, a static snapshot is run through `inspect.mjs`. The
live preview is also inspected.

**Final inspector result:** 0 FAIL on all 12 snapshot runs and on the live run. The remaining
WARNs are `still-page` (defended above) on five of the six states. Downloads and Home-with-probe
are clean.

**Critique** (`references/critique.md`):

| Round | Design | Usability | Creativity | Content | Overall | Top fixes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 6.5 | 6.5 | 8 | 7 | 6.9 (capped 6.0, FAILs open) | long titles ran to 3 lines (length-aware sizing); text passed under the phone's fixed tab bar (tabs moved into the flow); muted text under 7:1 (darkened); footer name clipped on phones |
| 2 | 7.5 | 8 | 8 | 7 | 7.7 | the footer stretched when the error box was hidden (fixed grid rows); Check link read as a second field (filled while it is the action, steps back once Download appears); Library rows ran 1376px wide (9 of 12 columns, titles balanced) |
| 3 | 7.5 | 8 | 8 | 7 | 7.7 | probe column rows spread apart beside a thumbnail (rows pinned to the top); scrollbar colours follow the scheme |

The rubric's photograph cap (design at most 6.5 with under four pictures) is not applied, because
the floor is waived above. What still falls short: Home has empty ground to the right of the form
at 1440px, because the screen holds only one field. A long title on the probe drops to the lead
size, which weakens that screen's hierarchy.

**Screenshots** (in `.taste-skill/inspect/`, which git ignores):

- `screens/<state>-<light|dark>-<1440|768|390>.png`: the full-page captures behind the critique.
  States are `home-empty`, `home-probe`, `home-error`, `downloads`, `library` and `settings`.
- `<state>-<scheme>/{desktop,tablet,mobile}-{fold,page-01}.jpg` and `report.json`: inspector output
  per snapshot.
- `live-home/`: inspector output for the live preview.
- `screens/check-{375,landscape,1440}-{no-preference,reduce}.png`: the 375px phone, landscape and
  reduced-motion checks.
- `screens/check-focus-{light,dark}.png`: focus rings.
- `screens/electron-home.png`: the packaged UI rendered in Electron under the production CSP.

## App icon

`design/icon.svg` is a flat 256-unit square: bottle green with the two gold bars of the equals sign,
kept inside the central 66% so Android adaptive masks never crop it. `desktop/scripts/make-icon.mjs`
(`npm -w desktop run make-icon`) renders it at 16, 24, 32, 48, 64, 128 and 256px. It uses the Chromium
that `@playwright/test` already installs, so there is no new dependency. It packs the renders into
`desktop/build/icon.ico`, which `electron-builder.yml` sets as `win.icon`. The Android launcher
icons (Task 7) derive from the same SVG.
