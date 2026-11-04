# EqDownload design

Date: 2026-11-04
Status: awaiting owner review

## Purpose

EqDownload downloads video and audio from links you paste or share to it. It replaces Snaptube for one person who wants the same job without ads, telemetry, accounts, or a vendor server in the loop. It runs on Windows and Android from one interface.

The engine is yt-dlp. EqDownload contains no extraction code of its own.

## Success criteria

1. Paste a YouTube link on Windows, pick a quality, get a file in the chosen folder.
2. Share a link from another Android app to EqDownload, pick a quality, get a file in `Downloads/EqDownload`.
3. The app makes no network request except to the sites you ask for and, when you press the button, to GitHub for an engine update.
4. A tag push builds `EqDownload.exe` and `EqDownload.apk` and attaches both to a GitHub Release.
5. The interface passes the taste-skill inspector at 1440, 768 and 390 px with no FAIL results.

## Non-goals for v1

- Accounts, sign-in, cloud sync.
- A built-in browser or in-app search.
- iOS and macOS.
- Batch playlist download. v1 handles single links.
- Any code or asset taken from Snaptube.

## Repository layout

```
EqDownloader/
  ui/            Vite + TypeScript interface, shared by both apps
  desktop/       Electron shell, bundled yt-dlp.exe and ffmpeg
  android/       Capacitor shell and the Kotlin EqEngine plugin
  docs/          specs and plans
  .github/workflows/
```

## Engine contract

The interface calls one TypeScript interface, `Engine`. Each shell implements it. A fake implementation backs UI tests.

| Method | Returns |
| --- | --- |
| `probe(url)` | title, thumbnail, duration, available formats |
| `start(url, preset, destination)` | download id |
| `cancel(id)` | nothing |
| `list()` | current and finished downloads |
| `updateEngine()` | new yt-dlp version string |
| `onProgress(handler)` | subscription for percent, speed, ETA, state |

Presets: Best, 1080p, 720p, Audio MP3, Audio M4A. A preset maps to a yt-dlp format selector in each shell, so the interface never builds selector strings.

## Windows shell

- Electron main process spawns the bundled `yt-dlp.exe` with ffmpeg on its path.
- The renderer runs with context isolation on, Node integration off, and a Content-Security-Policy that blocks remote scripts.
- A preload script exposes only the `Engine` methods through `contextBridge`.
- electron-builder produces one portable `EqDownload.exe`.
- Downloads default to the user's Downloads folder. Settings change it.

## Android shell

- Capacitor hosts the interface in a WebView.
- A Kotlin plugin, `EqEngine`, wraps the `youtubedl-android` library and its ffmpeg companion.
- Downloads run inside a foreground service, so they continue with the screen off. The service shows a progress notification.
- An intent filter accepts shared text and URLs, so "Share to EqDownload" opens the Home screen with the link filled in.
- Files save through MediaStore into `Downloads/EqDownload`. No broad storage permission is requested.
- Permissions: internet, foreground service (data sync), notifications.

## Screens

- **Home.** One field for the link. After a paste or share, the app probes the link and shows the title, thumbnail and the five presets. One primary action starts the download.
- **Downloads.** Live queue with progress, speed, ETA, cancel.
- **Library.** Finished files with Open and Share.
- **Settings.** Destination folder, default preset, engine version, Update engine.

## Privacy rules

- No analytics, ads, crash reporting, or accounts.
- No request leaves the app except to the sites you ask for and, on button press, `api.github.com` and `github.com` for yt-dlp releases.
- The Android manifest declares no usage-stats, package-visibility, overlay, or boot permissions.
- Cleartext HTTP is off. Android sets `usesCleartextTraffic="false"`.

## Errors

| Case | Message and action |
| --- | --- |
| Link not supported | Say the site is not supported. Offer Update engine. |
| Login, age, or region block | Say which one yt-dlp reported. No retry loop. |
| No network | Say so. Keep the item in the queue as Failed with a Retry button. |
| Engine out of date | Offer Update engine. This is the most likely cause of failures over time. |
| Disk full or no write access | Say so and show the destination path. |

## Testing

- **Contract tests.** The fake engine and each real shell pass the same Engine test list.
- **UI end to end.** Playwright drives the interface against the fake engine.
- **Design gate.** `lint.mjs` and `inspect.mjs` from the taste skill, run at 1440, 768 and 390 px.
- **Windows smoke test.** The packaged exe downloads a short public test clip in CI.
- **Android.** CI builds the APK and runs a unit test on the plugin's selector mapping. Nobody runs the APK on a device before release. The release notes mark it untested until the owner tries it.

## Release pipeline

- Trigger: a pushed tag matching `v*`.
- Windows job: install dependencies, bundle yt-dlp.exe and ffmpeg, run electron-builder, upload `EqDownload.exe`.
- Android job: install JDK and Android SDK, build the release APK, sign it, upload `EqDownload.apk`.
- A final job creates the GitHub Release and attaches both files.
- The repository stays private. Release downloads need a GitHub sign-in.
- Signing: a new keystore is generated once, stored as a repository secret, and a copy is kept off the repo. The owner approves this step before it happens.

## Visual design

The taste skill deals the direction when the interface gets built. The sequence is: inventory the subject, deal three directions, pick one, write the idea sentence, build, run the inspector, look at screenshots, fix, repeat. The design file lands in `docs/design/` with the dealt seed so the look is reproducible.

## Open risks

- yt-dlp breaks when sites change. The Update engine button handles it, and the release notes name the bundled version.
- `youtubedl-android` pins its own yt-dlp. A user update may need to replace the bundled binary at runtime. The first implementation task tests this.
- Sites can require a JavaScript runtime or PO token for some formats. v1 does not bundle either. Failures there show the engine's own message.
- Downloading content you do not have rights to is your responsibility. The README says so in one sentence.
