# EqDownload for Android

Capacitor shell with a Kotlin `EqEngine` plugin around youtubedl-android. Build: `npm -w ui run build`, `npx cap sync android`, then `gradlew.bat testDebugUnitTest assembleDebug assembleRelease` in this folder (set `ANDROID_HOME` and write `local.properties` with `sdk.dir`).

## Links and http

The plugin upgrades every `http://` link to `https://` before it reaches yt-dlp, and rejects every other scheme. This is partial protection. yt-dlp runs as its own process, so the Android cleartext setting does not bind it, and it may still follow a redirect or a stream manifest to an `http://` address.

## Downloads and process death

Downloads run in a foreground service started with `START_NOT_STICKY`. If Android kills the app, running downloads stop, their state is lost, and the half-finished staging folder is removed at the next service start once it is more than ten minutes old. Nothing resumes by itself.

## Not tested on a device

The APK has not been run on a device or emulator. See the task report for what the unit tests cover.
