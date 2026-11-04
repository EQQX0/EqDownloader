package app.eqdownload

import java.io.File
import java.net.HttpURLConnection
import java.security.MessageDigest
import java.net.URL
import org.json.JSONObject

/** The app's own update check. It runs only when the user presses the button and talks to api.github.com alone. */
object AppUpdate {
    const val LATEST_API = "https://api.github.com/repos/EQQX0/EqDownloader/releases/latest"
    private const val DOWNLOAD_PREFIX = "https://github.com/EQQX0/EqDownloader/releases/download/"
    private const val APK = "EqDownload.apk"
    private const val MAX_JSON = 1_000_000
    private const val SUMS = "SHA256SUMS.txt"
    private const val MAX_APK = 200L * 1024 * 1024

    data class Release(val version: String, val apkUrl: String)

    /** The SHA-256 listed for EqDownload.apk in the release's SHA256SUMS.txt, lowercase, or null. */
    fun expectedHash(sums: String): String? =
        sums.lineSequence().mapNotNull { Regex("^([0-9a-fA-F]{64})\s+\*?${Regex.escape(APK)}\s*$").find(it.trim())?.groupValues?.get(1)?.lowercase() }.firstOrNull()

    fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { i ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = i.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun get(url: String, limit: Long): java.io.InputStream {
        require(url.startsWith(DOWNLOAD_PREFIX)) { "Unexpected download address" }
        val c = URL(url).openConnection() as HttpURLConnection // GitHub's download links redirect to its asset host
        c.connectTimeout = 15_000
        c.readTimeout = 30_000
        c.setRequestProperty("User-Agent", "EqDownload")
        if (c.responseCode != 200) throw IllegalStateException("GitHub returned ${c.responseCode}")
        val len = c.contentLengthLong
        require(len <= limit) { "The update file is larger than expected" }
        return c.inputStream
    }

    /**
     * Downloads the release's APK into [dir], checks it against the release's own SHA256SUMS.txt, and returns it.
     * A file that does not match is deleted. Android still requires the same signing key to install it.
     */
    fun download(release: Release, dir: File, onPercent: (Int) -> Unit = {}): File {
        dir.deleteRecursively()
        dir.mkdirs()
        val sums = get(release.apkUrl.removeSuffix(APK) + SUMS, MAX_JSON.toLong()).use { String(it.readNBytes(MAX_JSON + 1), Charsets.UTF_8) }
        val expected = expectedHash(sums) ?: throw IllegalStateException("The release has no checksum for the Android file")
        val out = File(dir, APK)
        var done = 0L
        get(release.apkUrl, MAX_APK).use { input ->
            out.outputStream().use { o ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    done += n
                    check(done <= MAX_APK) { "The update file is larger than expected" }
                    o.write(buf, 0, n)
                }
            }
        }
        if (sha256(out) != expected) {
            out.delete()
            throw IllegalStateException("The downloaded update did not match its checksum, so it was discarded")
        }
        return out
    }

    fun parseVersion(v: String): List<Int>? {
        val m = Regex("^v?(\\d+)\\.(\\d+)\\.(\\d+)$").matchEntire(v.trim()) ?: return null
        return m.groupValues.drop(1).map { it.toInt() }
    }

    fun isNewer(latest: String, current: String): Boolean {
        val a = parseVersion(latest) ?: return false
        val b = parseVersion(current) ?: return false
        for (i in 0..2) if (a[i] != b[i]) return a[i] > b[i]
        return false
    }

    /** Reads the release JSON; the APK link must be this repository's own download URL. */
    fun parseRelease(json: String): Release {
        val o = JSONObject(json)
        val tag = o.optString("tag_name")
        require(parseVersion(tag) != null) { "GitHub returned an unreadable release" }
        val assets = o.optJSONArray("assets") ?: throw IllegalStateException("The newest release has no files yet")
        for (i in 0 until assets.length()) {
            val a = assets.getJSONObject(i)
            if (a.optString("name") == APK) {
                val url = a.optString("browser_download_url")
                require(url.startsWith(DOWNLOAD_PREFIX)) { "Unexpected download address" }
                return Release(tag.removePrefix("v"), url)
            }
        }
        throw IllegalStateException("The newest release has no Android file yet")
    }

    fun fetchLatest(): Release {
        val c = URL(LATEST_API).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 15_000
            c.readTimeout = 15_000
            c.setRequestProperty("Accept", "application/vnd.github+json")
            c.setRequestProperty("User-Agent", "EqDownload")
            if (c.responseCode != 200) throw IllegalStateException("GitHub returned ${c.responseCode}")
            val body = c.inputStream.use { it.readNBytes(MAX_JSON + 1) }
            require(body.size <= MAX_JSON) { "GitHub sent too much data" }
            return parseRelease(String(body, Charsets.UTF_8))
        } finally {
            c.disconnect()
        }
    }
}
