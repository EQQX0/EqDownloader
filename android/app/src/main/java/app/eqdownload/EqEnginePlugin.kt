package app.eqdownload

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.util.concurrent.Executors
import org.json.JSONObject

/**
 * The `EqEngine` plugin: the Android side of the shared `Engine` interface.
 * Every argument that comes from JavaScript is untrusted and validated here, not in the web layer.
 * The `destination` argument of `start` is ignored: files always end in Downloads/EqDownload through MediaStore.
 */
@CapacitorPlugin(
    name = "EqEngine",
    permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")],
)
class EqEnginePlugin : Plugin() {
    private val core: DownloadCore get() = DownloadCenter.install(context)
    private val pool = Executors.newCachedThreadPool()
    private var askedForNotifications = false
    private val progressListener: (Item) -> Unit = { notifyListeners("progress", it.toJs()) }

    override fun load() {
        core.addListener(progressListener)
        // Unpack python and ffmpeg ahead of the first download.
        pool.execute { runCatching { YtDlpRuntime.ensure(context) } }
    }

    override fun handleOnDestroy() {
        core.removeListener(progressListener)
        super.handleOnDestroy()
    }

    @PluginMethod
    fun probe(call: PluginCall) {
        val url = try {
            UrlGuard.requireHttpUrl(call.getString("url"))
        } catch (e: Throwable) {
            return reject(call, e)
        }
        pool.execute {
            try {
                YtDlpRuntime.ensure(context)
                val spec = YtDlpArgs.probe(url, CookieStore.fileFor(url))
                val request = YoutubeDLRequest(spec.url)
                for ((k, v) in spec.options) if (v == null) request.addOption(k) else request.addOption(k, v)
                request.addCommands(listOf("--"))
                val info = YoutubeDL.getInstance().getInfo(request)
                val formats = JSArray()
                for (f in info.formats.orEmpty()) {
                    formats.put(
                        JSObject()
                            .put("id", f.formatId.orEmpty())
                            .put("ext", f.ext.orEmpty())
                            .put("height", f.height.takeIf { it > 0 } ?: JSONObject.NULL)
                            .put("abr", f.abr.takeIf { it > 0 } ?: JSONObject.NULL)
                            .put("filesize", (f.fileSize.takeIf { it > 0 } ?: f.fileSizeApproximate.takeIf { it > 0 }) ?: JSONObject.NULL),
                    )
                }
                call.resolve(
                    JSObject()
                        .put("url", url)
                        .put("title", info.title?.takeIf { it.isNotBlank() } ?: url)
                        .put("thumbnail", info.thumbnail ?: JSONObject.NULL)
                        .put("durationSec", info.duration.takeIf { it > 0 } ?: JSONObject.NULL)
                        .put("formats", formats),
                )
            } catch (e: Throwable) {
                reject(call, e)
            }
        }
    }

    /** Title and picture from the site's own oEmbed lookup: much faster than a full yt-dlp check. YouTube and TikTok only. */
    @PluginMethod
    fun quickInfo(call: PluginCall) {
        val url = try {
            UrlGuard.requireHttpUrl(call.getString("url"))
        } catch (e: Throwable) {
            return reject(call, e)
        }
        pool.execute {
            try {
                val info = QuickInfo.fetch(url) ?: throw EngineException("unsupported", "No quick lookup for this site.")
                call.resolve(JSObject().put("title", info.title).put("thumbnail", info.thumbnail ?: JSONObject.NULL))
            } catch (e: Throwable) {
                reject(call, e)
            }
        }
    }

    @PluginMethod
    fun start(call: PluginCall) {
        // Validate before asking for anything.
        try {
            UrlGuard.requireHttpUrl(call.getString("url"))
            requirePreset(call.getString("preset"))
        } catch (e: Throwable) {
            return reject(call, e)
        }
        val needsAsk = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        if (needsAsk && !askedForNotifications) {
            askedForNotifications = true
            requestPermissionForAlias("notifications", call, "notificationsResolved")
        } else {
            begin(call)
        }
    }

    /** The download goes ahead whatever the answer: without the permission only the notification is hidden. */
    @PermissionCallback
    private fun notificationsResolved(call: PluginCall) = begin(call)

    private fun begin(call: PluginCall) {
        try {
            val item = core.enqueue(call.getString("url"), call.getString("preset"))
            try {
                DownloadService.start(context, item.id)
            } catch (e: Exception) {
                core.fail(item.id, EngineException("unknown", "Android would not start the download service."))
            }
            call.resolve(JSObject().put("id", item.id))
        } catch (e: Throwable) {
            reject(call, e)
        }
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        val id = call.getString("id")
        if (id != null) core.cancel(id)
        call.resolve()
    }

    @PluginMethod
    fun list(call: PluginCall) {
        val items = JSArray()
        for (i in core.list()) items.put(i.toJs())
        call.resolve(JSObject().put("items", items))
    }

    /** The on-device debug log: the commands that ran, what yt-dlp printed, and errors. */
    @PluginMethod
    fun readDebugLog(call: PluginCall) {
        call.resolve(JSObject().put("text", DebugLog.read()))
    }

    @PluginMethod
    fun clearDebugLog(call: PluginCall) {
        DebugLog.clear()
        call.resolve()
    }

    @PluginMethod
    fun appVersion(call: PluginCall) {
        try {
            val v = context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "unknown"
            call.resolve(JSObject().put("version", v))
        } catch (e: Throwable) {
            reject(call, e)
        }
    }

    /** Runs only when the user presses Check for app update. Resolves with `version` null when the app is current. */
    @PluginMethod
    fun checkAppUpdate(call: PluginCall) {
        pool.execute {
            try {
                val current = context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0.0.0"
                val latest = AppUpdate.fetchLatest()
                call.resolve(JSObject().put("version", if (AppUpdate.isNewer(latest.version, current)) latest.version else null))
            } catch (e: Throwable) {
                reject(call, e)
            }
        }
    }

    /**
     * Downloads the newest APK inside the app, checks its SHA-256 against the release's SHA256SUMS.txt, then hands it
     * to Android's installer. The link is read from GitHub again here, never taken from JavaScript. Android installs
     * it over this app only when it carries the same signing key. The first time, Android asks you to allow
     * installs from EqDownload; allow it and press Install again.
     */
    @PluginMethod
    fun installAppUpdate(call: PluginCall) {
        if (!updating.compareAndSet(false, true)) {
            reject(call, EngineException("busy", "An update is already downloading."))
            return
        }
        pool.execute {
            try {
                val latest = AppUpdate.fetchLatest()
                val current = context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0.0.0"
                AppUpdate.requireNewer(latest.version, current)
                if (!context.packageManager.canRequestPackageInstalls()) {
                    val settings = Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(settings)
                    throw EngineException("unknown", "Allow installs from EqDownload on the screen that opened, come back, and press Install again.")
                }
                val apk = AppUpdate.download(latest, java.io.File(context.cacheDir, "updates"))
                val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.updates", apk)
                val install = Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(install)
                call.resolve(JSObject().put("version", latest.version))
            } catch (e: Throwable) {
                reject(call, e)
            } finally {
                updating.set(false)
            }
        }
    }

    private val updating = java.util.concurrent.atomic.AtomicBoolean(false)

    private fun accountStatus(): JSObject =
        JSObject().also { o -> Site.entries.forEach { o.put(it.id, CookieStore.has(it)) } }

    /** Which sites have saved sign-in cookies. The cookies themselves never go to the web layer. */
    @PluginMethod
    fun accountStatus(call: PluginCall) {
        call.resolve(accountStatus())
    }

    /** Opens the site's own login page in SignInActivity; resolves with the new status once it closes. */
    @PluginMethod
    fun signIn(call: PluginCall) {
        val site = Site.parse(call.getString("site")) ?: return call.reject("Unknown site.", "unknown")
        try {
            val intent = Intent(context, SignInActivity::class.java).putExtra(SignInActivity.EXTRA_SITE, site.id)
            startActivityForResult(call, intent, "signInResult")
        } catch (e: Throwable) {
            reject(call, e)
        }
    }

    @com.getcapacitor.annotation.ActivityCallback
    private fun signInResult(call: PluginCall?, result: androidx.activity.result.ActivityResult) {
        call?.resolve(accountStatus())
    }

    /** Deletes the saved cookies for the site and clears the web view's cookie jar. */
    @PluginMethod
    fun signOut(call: PluginCall) {
        val site = Site.parse(call.getString("site")) ?: return call.reject("Unknown site.", "unknown")
        try {
            CookieStore.remove(site)
            android.webkit.CookieManager.getInstance().removeAllCookies(null)
            call.resolve(accountStatus())
        } catch (e: Throwable) {
            reject(call, e)
        }
    }

    /** Opens the support page in the browser. The address is fixed here; JavaScript cannot change it. */
    @PluginMethod
    fun openSupport(call: PluginCall) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://ko-fi.com/eqqx2")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            call.resolve()
        } catch (e: Throwable) {
            reject(call, e)
        }
    }

    /**
     * The text on the clipboard, only while the app is in front (Android hides it from background apps).
     * It goes to the web view and nowhere else; JavaScript sends it on only if it holds a link the user then checks.
     */
    @PluginMethod
    fun readClipboard(call: PluginCall) {
        try {
            val cm = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            val text = cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString().orEmpty()
            call.resolve(JSObject().put("text", text.take(2000)))
        } catch (e: Throwable) {
            call.resolve(JSObject().put("text", ""))
        }
    }

    /** Runs only when the user presses Update engine. Nothing calls it automatically. */
    @PluginMethod
    fun updateEngine(call: PluginCall) {
        pool.execute {
            try {
                YtDlpRuntime.ensure(context)
                YoutubeDL.getInstance().updateYoutubeDL(context.applicationContext, YoutubeDL.UpdateChannel.STABLE)
                val version = YoutubeDL.versionName(context.applicationContext)
                    ?: YoutubeDL.version(context.applicationContext)
                    ?: "unknown"
                call.resolve(JSObject().put("version", version))
            } catch (e: Throwable) {
                reject(call, e)
            }
        }
    }

    private var lastClipboard: String? = null

    /**
     * Called by MainActivity when the window gains focus, the moment Android allows reading the clipboard.
     * Only text that starts with one of the supported links is passed to the web layer, and each is passed once.
     */
    fun emitClipboard() {
        val text = try {
            val cm = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()?.trim().orEmpty()
        } catch (e: Throwable) {
            ""
        }
        if (text.isEmpty() || text == lastClipboard || CLIPBOARD_PREFIXES.none { text.startsWith(it) }) return
        lastClipboard = text
        notifyListeners("clipboard", JSObject().put("text", text.take(2000)), true)
    }

    /** Called by MainActivity for text shared from another app. Kept until the web view listens. */
    fun emitShare(text: String) {
        notifyListeners("share", JSObject().put("text", text), true)
    }

    private companion object {
        val CLIPBOARD_PREFIXES = listOf(
            "https://vt.tiktok.com/",
            "https://www.instagram.com/",
            "https://youtube.com/",
            "https://youtu.be/",
            "https://music.youtube.com/",
        )
    }

    private fun reject(call: PluginCall, e: Throwable) {
        val err = ErrorMapper.fromThrowable(e)
        call.reject(err.message, err.code)
    }

    /** Only the Presets.spec lookup maps to "Unknown quality preset."; other exceptions keep their own message. */
    private fun requirePreset(preset: String?) {
        try {
            Presets.spec(preset ?: "")
        } catch (_: IllegalArgumentException) {
            throw EngineException("unknown", "Unknown quality preset.")
        }
    }

    private fun Item.toJs(): JSObject = JSObject()
        .put("id", id)
        .put("url", url)
        .put("title", title)
        .put("preset", preset)
        .put("state", state)
        .put("percent", percent)
        .put("speedBps", speedBps ?: JSONObject.NULL)
        .put("etaSec", etaSec ?: JSONObject.NULL)
        .put("filePath", filePath ?: JSONObject.NULL)
        .put("error", error?.let { JSObject().put("code", it.code).put("message", it.message) } ?: JSONObject.NULL)
}
