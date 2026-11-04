package app.eqdownload

import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/** The app's own update check. It runs only when the user presses the button and talks to api.github.com alone. */
object AppUpdate {
    const val LATEST_API = "https://api.github.com/repos/EQQX0/EqDownloader/releases/latest"
    private const val DOWNLOAD_PREFIX = "https://github.com/EQQX0/EqDownloader/releases/download/"
    private const val APK = "EqDownload.apk"
    private const val MAX_JSON = 1_000_000

    data class Release(val version: String, val apkUrl: String)

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
