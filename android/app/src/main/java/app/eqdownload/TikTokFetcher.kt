package app.eqdownload

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONTokener

/** The user agent a page sees from this app's web views: Chrome's, without the "; wv" marker of an embedded view. */
object BrowserUa {
    fun clean(ua: String): String = ua.replace("; wv", "").replace(Regex(" Version/\\d+\\.\\d+"), "")
}

/**
 * Last resort for a signed-in TikTok link that yt-dlp cannot open. The bundled yt-dlp cannot imitate Chrome's network
 * handshake, and TikTok answers its page request with 403. Android's own web view can, and it already holds the
 * sign-in cookies. So the page is loaded in a hidden web view, the video address is read from it ([TikTokPage]),
 * and the file is downloaded with the same cookies. Nothing runs unless the user signed in to TikTok in Settings.
 */
object TikTokFetcher {
    private const val PAGE_TIMEOUT_S = 30L
    private const val POLL_MS = 500L
    private const val POLL_TRIES = 24

    private val cancels = ConcurrentHashMap<String, AtomicBoolean>()

    /** True for a link this fallback can handle, when the user has signed in. */
    fun applies(url: String): Boolean = Site.forUrl(url) == Site.TIKTOK && CookieStore.has(Site.TIKTOK)

    /** Stops download [id]. False when it is not running through this fallback. */
    fun cancel(id: String): Boolean {
        val flag = cancels[id] ?: return false
        flag.set(true)
        return true
    }

    /**
     * Loads the page, downloads the video into [outDir] and returns the file. Blocks; call it from a worker thread.
     * @throws DownloadCancelled when [cancel] was called, [EngineException] for anything TikTok or the network refused.
     */
    fun download(context: Context, id: String, url: String, outDir: File, onProgress: (Float, Long, String) -> Unit): File {
        val cancelled = AtomicBoolean(false)
        cancels[id] = cancelled
        try {
            val (media, ua) = loadMedia(context.applicationContext, url, cancelled)
            DebugLog.add("tiktok", "$id page read, ${media.urls.size} address(es)")
            outDir.mkdirs()
            val target = File(outDir, TikTokPage.fileName(media))
            var last: Throwable? = null
            for ((n, mediaUrl) in media.urls.withIndex()) {
                if (cancelled.get()) throw DownloadCancelled()
                try {
                    fetch(mediaUrl, target, ua, cancelled, onProgress)
                    DebugLog.add("tiktok", "$id downloaded from address ${n + 1}")
                    return target
                } catch (e: DownloadCancelled) {
                    throw e
                } catch (e: IOException) {
                    last = e
                    DebugLog.add("tiktok", "$id address ${n + 1} failed: ${e.message?.take(200)}")
                }
            }
            throw EngineException("blocked", "TikTok refused the video download (${last?.message?.take(120) ?: "no address worked"}).")
        } finally {
            cancels.remove(id)
        }
    }

    private fun loadMedia(context: Context, url: String, cancelled: AtomicBoolean): Pair<TikTokPage.Media, String> {
        val main = Handler(Looper.getMainLooper())
        val result = CompletableFuture<String>()
        var web: WebView? = null
        var ua = ""
        main.post {
            try {
                val w = WebView(context)
                web = w
                val cookies = CookieManager.getInstance()
                cookies.setAcceptCookie(true)
                cookies.setAcceptThirdPartyCookies(w, true)
                w.settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    allowFileAccess = false
                    allowContentAccess = false
                    userAgentString = BrowserUa.clean(userAgentString)
                    ua = userAgentString
                }
                var tries = 0
                var polling = false
                var lastText: String? = null
                val script = "(function(){var e=document.getElementById('${TikTokPage.DATA_ELEMENT_ID}');return e?e.textContent:null})()"
                val poll = object : Runnable {
                    override fun run() {
                        if (cancelled.get()) {
                            result.completeExceptionally(DownloadCancelled())
                            return
                        }
                        w.evaluateJavascript(script) { raw ->
                            val text = if (raw == null || raw == "null") null else (JSONTokener(raw).nextValue() as? String)
                            if (text != null) lastText = text
                            when {
                                // A page can hold the data block without the video (a redirect page, a check): keep waiting.
                                text != null && TikTokPage.isReady(text) -> result.complete(text)
                                ++tries >= POLL_TRIES -> {
                                    val last = lastText
                                    if (last != null) result.complete(last)
                                    else result.completeExceptionally(EngineException("unknown", "TikTok's page did not load in time."))
                                }
                                else -> main.postDelayed(this, POLL_MS)
                            }
                        }
                    }
                }
                w.webViewClient = object : WebViewClient() {
                    // Pages stay on https; anything else (intent:, market:, http:) is ignored.
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                        request.url.scheme != "https"

                    override fun onPageFinished(view: WebView, finished: String) {
                        // Redirects (short links) finish several pages; one polling chain covers them all.
                        if (!polling) {
                            polling = true
                            poll.run()
                        }
                    }
                }
                w.loadUrl(url)
            } catch (t: Throwable) {
                result.completeExceptionally(t)
            }
        }
        try {
            val json = result.get(PAGE_TIMEOUT_S, TimeUnit.SECONDS)
            return try {
                TikTokPage.parse(json) to ua
            } catch (e: EngineException) {
                DebugLog.add("tiktok", "page not usable: ${TikTokPage.shape(json)}")
                throw e
            }
        } catch (e: ExecutionException) {
            throw e.cause ?: e
        } catch (e: TimeoutException) {
            throw EngineException("unknown", "TikTok's page did not load in time.")
        } finally {
            main.post {
                web?.stopLoading()
                web?.destroy()
            }
        }
    }

    private fun fetch(mediaUrl: String, target: File, ua: String, cancelled: AtomicBoolean, onProgress: (Float, Long, String) -> Unit) {
        val part = File(target.parentFile, target.name + ".part")
        val conn = URL(mediaUrl).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.setRequestProperty("User-Agent", ua)
            conn.setRequestProperty("Referer", "https://www.tiktok.com/")
            conn.setRequestProperty("Accept", "*/*")
            conn.setRequestProperty("Range", "bytes=0-")
            // The web view's cookie store decides which cookies belong to this address.
            CookieManager.getInstance().getCookie(mediaUrl)?.takeIf { it.isNotBlank() }?.let { conn.setRequestProperty("Cookie", it) }
            val code = conn.responseCode
            if (code != 200 && code != 206) throw IOException("HTTP $code")
            val total = conn.contentLengthLong
            var done = 0L
            val started = System.nanoTime()
            var lastEmit = 0L
            conn.inputStream.use { input ->
                part.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        if (cancelled.get()) throw DownloadCancelled()
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        val now = System.nanoTime()
                        if (total > 0 && now - lastEmit >= 300_000_000L) {
                            lastEmit = now
                            val secs = ((now - started) / 1e9).coerceAtLeast(0.001)
                            val speed = done / secs
                            val eta = if (speed > 0) ((total - done) / speed).toLong() else -1L
                            onProgress(done * 100f / total, eta, progressLine(done * 100.0 / total, speed))
                        }
                    }
                }
            }
            if (done == 0L) throw IOException("empty response")
            if (total > 0 && done < total) throw IOException("cut short at $done of $total bytes")
            target.delete()
            if (!part.renameTo(target)) throw IOException("could not save the file")
        } finally {
            conn.disconnect()
            part.delete()
        }
    }

    /** A line in yt-dlp's shape, so the speed shown comes out of [ProgressParser] like every other download. */
    internal fun progressLine(percent: Double, bytesPerSec: Double): String {
        val (value, unit) = when {
            bytesPerSec >= 1 shl 20 -> bytesPerSec / (1 shl 20) to "MiB"
            bytesPerSec >= 1 shl 10 -> bytesPerSec / (1 shl 10) to "KiB"
            else -> bytesPerSec to "B"
        }
        return String.format(Locale.US, "[download] %5.1f%% at %.2f%s/s", percent, value, unit)
    }
}
