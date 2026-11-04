package app.eqdownload

import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import org.json.JSONObject

/** Title and thumbnail from a site's public oEmbed endpoint. Fast, and used only for YouTube and TikTok links. */
object QuickInfo {
    data class Info(val title: String, val thumbnail: String?)

    private const val MAX_BYTES = 200_000

    /** The oEmbed address for a link, or null when the site has no quick lookup here. */
    fun endpoint(link: String): String? {
        val host = try { URL(link).host.lowercase() } catch (e: Exception) { return null }
        val enc = URLEncoder.encode(link, "UTF-8")
        return when {
            host == "youtu.be" || host == "youtube.com" || host == "www.youtube.com" || host == "music.youtube.com" ->
                "https://www.youtube.com/oembed?format=json&url=$enc"
            host == "tiktok.com" || host.endsWith(".tiktok.com") -> "https://www.tiktok.com/oembed?url=$enc"
            else -> null
        }
    }

    fun parse(json: String): Info? {
        val o = JSONObject(json)
        val title = o.optString("title").trim()
        if (title.isEmpty()) return null
        val thumb = o.optString("thumbnail_url").takeIf { it.startsWith("https://") }
        return Info(title.take(300), thumb)
    }

    fun fetch(link: String): Info? {
        val api = endpoint(link) ?: return null
        val c = URL(api).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 4_000
            c.readTimeout = 4_000
            c.setRequestProperty("User-Agent", "EqDownload")
            if (c.responseCode != 200) return null
            val body = c.inputStream.use { it.readNBytes(MAX_BYTES + 1) }
            if (body.size > MAX_BYTES) return null
            return parse(String(body, Charsets.UTF_8))
        } finally {
            c.disconnect()
        }
    }
}
