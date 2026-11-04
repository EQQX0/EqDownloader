# EqDownload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship EqDownload, a yt-dlp based video and audio downloader with one shared interface, as `EqDownload.exe` (Windows) and `EqDownload.apk` (Android) GitHub Releases.

**Architecture:** A Vite + TypeScript interface calls an `Engine` interface. An Electron shell implements it by spawning yt-dlp. A Capacitor shell implements it with a Kotlin plugin around `youtubedl-android`. A fake engine backs UI tests.

**Tech Stack:** TypeScript, Vite, Vitest, Playwright, Electron, electron-builder, Capacitor, Kotlin, youtubedl-android, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-04-eqdownload-design.md`

## Global Constraints

- No analytics, ads, crash reporting, or accounts. No network request except to sites the user names and, on button press, `api.github.com` and `github.com` for yt-dlp releases.
- Android permissions: internet, foreground service (data sync), notifications. Nothing else. `usesCleartextTraffic="false"`.
- Electron: `contextIsolation: true`, `nodeIntegration: false`, CSP blocking remote scripts, preload exposes only the `Engine` methods.
- Presets, exactly five: Best, 1080p, 720p, Audio MP3, Audio M4A.
- Android saves through MediaStore into `Downloads/EqDownload`. Windows defaults to the user's Downloads folder.
- v1 handles single links. No batch playlists, no in-app search, no browser, no iOS.
- No code or asset from Snaptube.
- Visual design follows the taste skill: `lint.mjs` and `inspect.mjs` pass with no FAIL at 1440, 768 and 390 px.
- Release trigger is a `v*` tag. The repository stays private.

## Review Focus

1. A pasted string with surrounding text or no URL (`"Watch this https://youtu.be/x now"`, `"hello"`). Expect the first URL extracted, or a clear "no link found" and no engine call.
2. A title with characters Windows rejects (`<>:"/\|?*`), emoji, or 300 characters. Expect a valid, shortened filename.
3. Cancel while running. Expect the process killed, partial files removed, state `cancelled`.
4. Two downloads of the same link at once. Expect two files with different names and no crash.
5. yt-dlp progress lines with `NA` for speed or ETA. Expect `null`, not `NaN`.

---

### Task 1: Workspace, engine types, fake engine

**Files:**
- Create: `package.json` (npm workspaces: `ui`, `desktop`), `.gitignore`, `ui/package.json`, `ui/tsconfig.json`, `ui/vite.config.ts`
- Create: `ui/src/engine/types.ts`, `ui/src/engine/fake.ts`
- Test: `ui/src/engine/engine.contract.ts`, `ui/src/engine/fake.test.ts`

**Interfaces:**
- Produces, in `types.ts`:
  - `type Preset = 'best' | '1080p' | '720p' | 'mp3' | 'm4a'`
  - `type DownloadState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'`
  - `type EngineErrorCode = 'unsupported' | 'blocked' | 'network' | 'outdated' | 'disk' | 'unknown'`
  - `interface EngineError { code: EngineErrorCode; message: string }`
  - `interface FormatInfo { id: string; ext: string; height: number | null; abr: number | null; filesize: number | null }`
  - `interface ProbeResult { url: string; title: string; thumbnail: string | null; durationSec: number | null; formats: FormatInfo[] }`
  - `interface DownloadItem { id: string; url: string; title: string; preset: Preset; state: DownloadState; percent: number; speedBps: number | null; etaSec: number | null; filePath: string | null; error: EngineError | null }`
  - `interface Engine { probe(url: string): Promise<ProbeResult>; start(url: string, preset: Preset, destination: string): Promise<string>; cancel(id: string): Promise<void>; list(): Promise<DownloadItem[]>; updateEngine(): Promise<string>; onProgress(handler: (item: DownloadItem) => void): () => void }`
- Produces, in `engine.contract.ts`: `runEngineContract(name: string, make: () => Engine): void`, a Vitest suite every engine passes.
- Produces, in `fake.ts`: `class FakeEngine implements Engine` with a constructor option `{ delayMs: number }`.

- [ ] **Step 1:** Write `fake.test.ts` calling `runEngineContract('FakeEngine', () => new FakeEngine({ delayMs: 0 }))`. The contract asserts: `probe('https://example.test/v')` returns a title and at least one format; `start` returns an id that appears in `list()`; progress events end with state `done` and `percent` 100; `cancel` on a running id yields state `cancelled`; `probe('not a url')` rejects with `EngineError` code `unsupported`.
- [ ] **Step 2:** Run `npm -w ui test`. Expected: FAIL, modules not found.
- [ ] **Step 3:** Create the workspace files and `types.ts` exactly as above. Implement `FakeEngine` with in-memory state and timers.
- [ ] **Step 4:** Run `npm -w ui test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: workspace, engine types, fake engine`.

### Task 2: URL extraction and preset mapping

**Files:**
- Create: `ui/src/lib/url.ts`, `ui/src/engine/presets.ts`
- Test: `ui/src/lib/url.test.ts`, `ui/src/engine/presets.test.ts`

**Interfaces:**
- Produces: `extractUrl(text: string): string | null` returns the first `http` or `https` URL in the text, trailing punctuation `.,)` trimmed.
- Produces: `presetToSpec(p: Preset): { format: string; extractAudio: boolean; audioFormat: 'mp3' | 'm4a' | null }` with these exact values:
  - `best` → `bv*+ba/b`, false, null
  - `1080p` → `bv*[height<=1080]+ba/b[height<=1080]`, false, null
  - `720p` → `bv*[height<=720]+ba/b[height<=720]`, false, null
  - `mp3` → `ba/b`, true, `mp3`
  - `m4a` → `ba[ext=m4a]/ba/b`, true, `m4a`

- [ ] **Step 1:** Write `url.test.ts` with: `"Watch this https://youtu.be/x now"` → `https://youtu.be/x`; `"see https://a.test/p)."` → `https://a.test/p`; `"hello"` → `null`; `""` → `null`. Write `presets.test.ts` asserting the five specs above.
- [ ] **Step 2:** Run `npm -w ui test`. Expected: FAIL.
- [ ] **Step 3:** Implement both functions. Use one regex for URL extraction.
- [ ] **Step 4:** Run `npm -w ui test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: url extraction and preset mapping`.

### Task 3: Desktop yt-dlp engine

**Files:**
- Create: `desktop/package.json`, `desktop/tsconfig.json`, `desktop/src/main/ytdlp.ts`, `desktop/src/main/filename.ts`, `desktop/src/main/paths.ts`
- Test: `desktop/src/main/ytdlp.test.ts`, `desktop/src/main/filename.test.ts`, `desktop/test/fake-ytdlp.mjs`

**Interfaces:**
- Consumes: `Engine`, `Preset`, `DownloadItem`, `presetToSpec` from the `ui` workspace.
- Produces: `buildArgs(url: string, preset: Preset, destination: string): string[]` including `--newline`, `--windows-filenames`, `--progress-template` and `-o` with template `%(title).120B [%(id)s].%(ext)s`; plus `-x --audio-format <fmt>` for audio presets.
- Produces: `parseProgressLine(line: string): { percent: number; speedBps: number | null; etaSec: number | null } | null`. The template is `download:%(progress._percent_str)s|%(progress.speed)s|%(progress.eta)s`. `NA` or `None` becomes `null`.
- Produces: `safeFileName(title: string): string` replaces `<>:"/\|?*` and control characters with `_`, trims to 120 characters, never returns an empty string.
- Produces: `class YtDlpEngine implements Engine`, constructor `{ ytdlpPath: string; ffmpegPath: string }`.
- Produces: `resolveBinaries(): { ytdlpPath: string; ffmpegPath: string }` (bundled under `resources/bin` when packaged).

- [ ] **Step 1:** Write `ytdlp.test.ts` running `runEngineContract` against `YtDlpEngine` pointed at `test/fake-ytdlp.mjs`, a Node script that emulates `-J` JSON output and progress lines. Add tests: `parseProgressLine('download: 45.2%|1234567|12')` → `{ percent: 45.2, speedBps: 1234567, etaSec: 12 }`; `parseProgressLine('download:  1.0%|NA|NA')` → speed and ETA `null`; cancel kills the process and removes `*.part` files (Review Focus 3); two simultaneous `start` calls on the same URL produce different file paths (Review Focus 4). Write `filename.test.ts` with `a<b>:c|d?.mp4` and a 300 character title (Review Focus 2).
- [ ] **Step 2:** Run `npm -w desktop test`. Expected: FAIL.
- [ ] **Step 3:** Implement the modules. Spawn with `child_process.spawn`, no shell. Map stderr text to `EngineErrorCode` (`Unsupported URL` → `unsupported`; `Sign in`, `age`, `not available in your country` → `blocked`; `Unable to download webpage` → `network`; `HTTP Error 403` or `nsig` → `outdated`; `No space left` → `disk`).
- [ ] **Step 4:** Run `npm -w desktop test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: desktop yt-dlp engine`.

### Task 4: Electron shell and packaging

**Files:**
- Create: `desktop/src/main/main.ts`, `desktop/src/main/preload.ts`, `desktop/electron-builder.yml`, `desktop/scripts/fetch-binaries.mjs`
- Test: `desktop/test/security.test.ts`

**Interfaces:**
- Consumes: `YtDlpEngine`, `resolveBinaries`.
- Produces: `window.eq: Engine & { chooseFolder(): Promise<string | null>; revealFile(path: string): Promise<void> }` exposed through `contextBridge`.
- Produces: IPC channels named `eq:<method>`. Progress is pushed on `eq:progress`.

- [ ] **Step 1:** Write `security.test.ts` that reads the `BrowserWindow` options from `main.ts` through an exported `windowOptions()` and asserts `contextIsolation === true`, `nodeIntegration === false`, `sandbox === true`, and that the CSP string contains `default-src 'self'` and no `unsafe-eval`.
- [ ] **Step 2:** Run `npm -w desktop test -- security`. Expected: FAIL.
- [ ] **Step 3:** Implement `main.ts` (window, IPC handlers, `updateEngine` downloading the latest `yt-dlp.exe` from GitHub releases into the user data folder and preferring it over the bundled one) and `preload.ts`. `fetch-binaries.mjs` downloads pinned yt-dlp and ffmpeg builds and verifies a SHA-256 written in the script. `electron-builder.yml` targets `portable`, artifact name `EqDownload.exe`.
- [ ] **Step 4:** Run `npm -w desktop test`, then `npm -w desktop run dist`. Expected: tests PASS and `desktop/dist/EqDownload.exe` exists.
- [ ] **Step 5:** Smoke test: run the built exe with `--smoke https://www.youtube.com/watch?v=jNQXAC9IVRw` (a 19 second public clip). The flag downloads it and exits 0 when a non-empty file exists. Expected: exit code 0.
- [ ] **Step 6:** Commit `feat: electron shell and portable build`.

### Task 5: Interface behavior

**Files:**
- Create: `ui/src/main.ts`, `ui/src/state/store.ts`, `ui/src/screens/home.ts`, `ui/src/screens/downloads.ts`, `ui/src/screens/library.ts`, `ui/src/screens/settings.ts`, `ui/index.html`
- Test: `ui/src/state/store.test.ts`, `ui/e2e/app.spec.ts`

**Interfaces:**
- Consumes: `Engine`, `extractUrl`, `presetToSpec`.
- Produces: `createStore(engine: Engine): Store` with `submitLink(text: string): Promise<void>` (extracts the URL, probes, sets `probe` state or `error`), `startDownload(preset: Preset): Promise<void>`, `cancel(id: string): Promise<void>`, `retry(id: string): Promise<void>`, and `subscribe(fn): () => void`.
- Produces: `getEngine(): Engine` which returns `window.eq` when present, else `FakeEngine({ delayMs: 400 })`.

- [ ] **Step 1:** Write `store.test.ts`: `submitLink('hello')` sets error `no link found` and makes zero `probe` calls (Review Focus 1); `submitLink('Watch https://a.test/v now')` probes `https://a.test/v`; a failed download shows state `failed` with a Retry that starts a new item; `0.0` percent and `null` speed render without `NaN` (Review Focus 5). Write `e2e/app.spec.ts` with Playwright: paste a link, see the five preset buttons, press Best, see the item reach Done in Downloads, see it in Library.
- [ ] **Step 2:** Run `npm -w ui test` and `npx playwright test`. Expected: FAIL.
- [ ] **Step 3:** Implement store and four screens with semantic HTML, no framework. Screens match the spec: Home, Downloads, Library, Settings (destination folder, default preset, engine version, Update engine).
- [ ] **Step 4:** Run both test commands. Expected: PASS.
- [ ] **Step 5:** Commit `feat: interface screens and store`.

### Task 6: Visual design pass

**Files:**
- Create: `ui/src/styles/*.css`, `docs/design/direction.md`
- Modify: `ui/index.html`, `ui/src/screens/*.ts` (markup and classes only)

**Interfaces:**
- Consumes: the working interface from Task 5. Behavior and test ids stay unchanged.

- [ ] **Step 1:** Load the `design-taste-frontend` skill. Inventory the subject, run `draw.mjs --sector tools --sections list,how-it-works --options 3`, choose a direction against the inventory, write the idea sentence, then deal the full sheet. Save the sheet and the seed to `docs/design/direction.md`.
- [ ] **Step 2:** Build tokens, type, and the four screens from the sheet. Keep Task 5 selectors working.
- [ ] **Step 3:** Run `lint.mjs ui/src` and `inspect.mjs` against the Vite preview. Expected: no FAIL at 1440, 768 and 390 px. Open each screenshot and run the critique pass from `references/critique.md`. At most three fix rounds.
- [ ] **Step 4:** Run `npm -w ui test` and `npx playwright test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: visual design`.

### Task 7: Android shell and plugin

**Files:**
- Create: `android/` via `npx cap add android`; `android/app/src/main/java/app/eqdownload/EqEnginePlugin.kt`, `DownloadService.kt`, `Presets.kt`, `MediaStoreSaver.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`, `android/app/build.gradle`, `capacitor.config.ts`
- Test: `android/app/src/test/java/app/eqdownload/PresetsTest.kt`, `ManifestTest.kt`

**Interfaces:**
- Produces: `object Presets { fun spec(p: String): PresetSpec }` returning the same five specs as `presetToSpec` in Task 2.
- Produces: the Capacitor plugin `EqEngine` with methods `probe`, `start`, `cancel`, `list`, `updateEngine` and event `progress`, mapped to the `Engine` interface through `ui/src/engine/capacitor.ts: class CapacitorEngine implements Engine`.
- Produces: `MediaStoreSaver.save(context, file, mime): Uri` writing to `Downloads/EqDownload`.

- [ ] **Step 1:** Write `PresetsTest.kt` asserting the five specs equal the Task 2 values. Write `ManifestTest.kt` that parses `AndroidManifest.xml` and asserts the uses-permission set equals exactly `INTERNET`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `POST_NOTIFICATIONS`, that `usesCleartextTraffic` is `false`, and that `allowBackup` is `false`.
- [ ] **Step 2:** Run `./gradlew testDebugUnitTest` in `android/`. Expected: FAIL.
- [ ] **Step 3:** Implement `Presets.kt`, the plugin and foreground service (notification with progress and a Cancel action), the share intent filter for `text/plain` in the manifest, and `CapacitorEngine`. `getEngine()` in the interface chooses `CapacitorEngine` when `Capacitor.isNativePlatform()`.
- [ ] **Step 4:** Run `./gradlew testDebugUnitTest assembleDebug`. Expected: tests PASS and a debug APK exists.
- [ ] **Step 5:** Commit `feat: android shell and engine plugin`.

### Task 8: CI and release pipeline

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`

- [ ] **Step 1:** `ci.yml` on push and pull request: Node 22, `npm ci`, `npm test --workspaces`, Playwright, and `./gradlew testDebugUnitTest` on `ubuntu-latest`. Expected on first push: green.
- [ ] **Step 2:** `release.yml` on tag `v*`. Job `windows` on `windows-latest`: install, fetch binaries, `npm -w desktop run dist`, run the smoke test from Task 4, upload `EqDownload.exe`. Job `android` on `ubuntu-latest`: set up JDK 21 and the Android SDK, `npx cap sync android`, `./gradlew assembleRelease`, sign with the keystore from secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, rename to `EqDownload.apk`. Job `publish` needs both, creates the Release with `gh release create` and attaches the two files, and writes a note that the APK is untested on a device.
- [ ] **Step 3:** Ask the owner before generating the keystore. After approval, generate it with `keytool`, store the secrets with `gh secret set`, keep a copy outside the repo.
- [ ] **Step 4:** Commit `ci: test and release workflows`.

### Task 9: README, push, first release

**Files:**
- Create: `README.md`

- [ ] **Step 1:** Write the README: what it does, install on Windows and Android, the privacy rules from the spec, how to update the engine, a one sentence responsibility notice, build instructions. Run it through the `stop-slop` skill first.
- [ ] **Step 2:** Run the full local test list: `npm test --workspaces`, `npx playwright test`, `./gradlew testDebugUnitTest`. Expected: all PASS.
- [ ] **Step 3:** Push `main` with `git push -u origin main`. Confirm the `ci` run is green with `gh run watch`.
- [ ] **Step 4:** Tag `v0.1.0`, push the tag, watch `release.yml` with `gh run watch`. Expected: a Release with `EqDownload.exe` and `EqDownload.apk`.
- [ ] **Step 5:** Download both assets with `gh release download v0.1.0` and report SHA-256 values to the owner. State which parts were verified (Windows smoke test in CI) and which were not (Android on a device).
