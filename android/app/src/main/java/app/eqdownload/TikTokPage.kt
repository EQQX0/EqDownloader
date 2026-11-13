package app.eqdownload

import org.json.JSONArray
import org.json.JSONObject

/**
 * Reads a TikTok video page the way the site's own web player does. TikTok puts the video's data in a JSON block
 * (`__UNIVERSAL_DATA_FOR_REHYDRATION__`) in the page. This file finds the video address in it; the loading and
 * downloading happen in [TikTokFetcher]. No TikTok request is made here, so it can be tested on the JVM.
 */
object TikTokPage {
    const val DATA_ELEMENT_ID = "__UNIVERSAL_DATA_FOR_REHYDRATION__"

    data class Media(val id: String, val title: String, val urls: List<String>)

    /**
     * @throws EngineException `blocked` when TikTok answers with a status code instead of a video (age limit, private,
     * removed), `unknown` when the page holds no video data in a shape this code knows.
     */
    fun parse(json: String): Media {
        val root = try {
            JSONObject(json)
        } catch (e: Exception) {
            throw EngineException("unknown", "TikTok's page could not be read.")
        }
        val detail = root.optJSONObject("__DEFAULT_SCOPE__")?.optJSONObject("webapp.video-detail")
        val status = detail?.optInt("statusCode", 0) ?: 0
        if (status != 0) {
            throw EngineException("blocked", "TikTok would not show this video (code $status). It may be private, removed or limited to some accounts.")
        }
        val item = detail?.optJSONObject("itemInfo")?.optJSONObject("itemStruct")
            ?: throw EngineException("unknown", "TikTok's page held no video data.")
        val video = item.optJSONObject("video")
            ?: throw EngineException("unknown", "TikTok's page held no video. Photo posts are not supported.")
        val urls = mutableListOf<String>()
        // The plain play address first (no watermark), then the page's other encodings, best bitrate first,
        // and the download address last because it can carry TikTok's watermark.
        urls += stringOf(video.opt("playAddr"))
        val bitrates = video.optJSONArray("bitrateInfo")
        if (bitrates != null) {
            val list = (0 until bitrates.length()).mapNotNull { bitrates.optJSONObject(it) }
            for (b in list.sortedByDescending { it.optLong("Bitrate", 0) }) {
                urls += urlList(b.optJSONObject("PlayAddr")?.optJSONArray("UrlList"))
            }
        }
        urls += stringOf(video.opt("downloadAddr"))
        val usable = urls.filter { it.startsWith("https://") }.distinct()
        if (usable.isEmpty()) throw EngineException("unknown", "TikTok's page held no video address.")
        return Media(item.optString("id"), item.optString("desc").trim(), usable)
    }

    private fun stringOf(v: Any?): List<String> = if (v is String && v.isNotBlank()) listOf(v) else emptyList()

    private fun urlList(a: JSONArray?): List<String> =
        if (a == null) emptyList() else (0 until a.length()).mapNotNull { (a.opt(it) as? String)?.takeIf { s -> s.isNotBlank() } }

    /** `Title [id].mp4`, the same shape yt-dlp's output template gives. */
    fun fileName(media: Media): String {
        val stem = FileNames.safe(media.title.ifBlank { "TikTok" }, 100)
        return if (media.id.isNotEmpty()) "$stem [${media.id}].mp4" else "$stem.mp4"
    }
}
