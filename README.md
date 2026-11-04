# EqDownload

EqDownload saves video and audio from links you paste or share to it. It runs on Windows and Android with the same interface. It has no ads, no accounts, no analytics and no server of its own. The engine is yt-dlp.

You are responsible for having the right to download what you download.

## Install

Both files are on the [Releases page](../../releases). The repository is private, so sign in to GitHub first.

**Windows.** Download `EqDownload.exe` and run it. It is portable: no installer, no admin rights. Windows SmartScreen will warn about an unknown publisher because the exe is not code-signed. Choose "More info", then "Run anyway".

**Android.** Download `EqDownload.apk` and open it. Android asks you to allow installs from your browser or file manager. It needs Android 10 or newer on a 64-bit ARM phone. The APK has not been run on a device or emulator yet, so expect rough edges. Share a link from any app and pick EqDownload.

Check the downloads against `SHA256SUMS.txt` on the release.

**In a browser.** https://eqdownload.vercel.app takes a pasted link and returns direct download links, so an iPhone can save a file without an app. It works only for sites that serve a plain video or audio file, such as the Internet Archive. YouTube blocks the host's servers, and sites that stream in pieces need ffmpeg, so those need the apps. The page's source is in `site/`; the link you paste goes to that server and appears in the host's request logs.

## Use

1. Paste a link, or share one from another app.
2. EqDownload shows the title and thumbnail. Pick Best, 1080p, 720p, MP3 or M4A.
3. Press Download. Progress, speed and ETA show under Downloads. Finished files are listed in Library. On Windows, "Show in folder" opens the file's folder.

Files go to your Downloads folder on Windows (change it in Settings) and to `Downloads/EqDownload` on Android.

## When a download fails

Sites change often, and yt-dlp changes with them. If a link that used to work stops working, open Settings and press Update engine. On Windows the app asks GitHub for the newest yt-dlp release and checks its SHA-256 against the release's published checksum file before using it. On Android the update uses the youtubedl-android library's own updater over HTTPS. It does not check a checksum.

Some sites need a login, an age check, or a different region. EqDownload shows the reason yt-dlp reports and does not retry on its own.

## Privacy

- No analytics, ads, crash reporting or accounts.
- The app contacts the sites you ask for. When you press Update engine, it also contacts `api.github.com`, `github.com` and GitHub's release asset hosts. Nothing else.
- The Android app asks for four permissions: internet, foreground service, foreground service data sync, and notifications. A unit test fails the build if the manifest gains another.
- The Windows window runs with context isolation, no Node access and a Content-Security-Policy that blocks remote scripts.
- Android turns cleartext HTTP off and upgrades `http://` links to `https://` before they reach yt-dlp. This is partial protection: yt-dlp runs as its own process, so it may still follow a redirect to an `http://` address.

## Build from source

You need Node 22. For Android you also need JDK 21 and the Android SDK.

```
npm ci
npm test                       # UI and desktop unit tests
npm run test:e2e               # Playwright against the fake engine
npm -w desktop run dist        # portable exe in desktop/release
npm -w ui run build && npx cap sync android
cd android && ./gradlew testDebugUnitTest assembleRelease
```

`android/README.md` has the Android details. A pushed tag matching `v*` builds both files and creates a release; see `.github/workflows/release.yml`.

## Third-party software

- [yt-dlp](https://github.com/yt-dlp/yt-dlp), Unlicense. Bundled.
- [FFmpeg](https://ffmpeg.org), built with GPL components. The Windows exe bundles a GPL build from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds), with its license text shipped as `ffmpeg-LICENSE.txt` next to ffmpeg.exe. The Android app bundles the ffmpeg library from [youtubedl-android](https://github.com/yausername/youtubedl-android). The source for every bundled FFmpeg build is available from those projects. If you cannot find it there, open an issue and the maintainer will send you the source for the exact version you have.
- [Electron](https://www.electronjs.org), [Capacitor](https://capacitorjs.com) and [youtubedl-android](https://github.com/yausername/youtubedl-android).
- Fonts are listed with their licenses in `ui/public/fonts/*-OFL.txt`.
