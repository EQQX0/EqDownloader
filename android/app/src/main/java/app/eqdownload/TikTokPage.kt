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
        val detail = videoDetail(root)
        val status = detail?.optInt("statusCode", 0) ?: 0
        if (status != 0) {
            throw EngineException("blocked", "TikTok would not show this video (code $status). It may be private, removed or limited to some accounts.")
        }
        val item = detail?.optJSONObject("itemInfo")?.optJSONObject("itemStruct") ?: findItem(root)
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

    /** The `webapp.video-detail` block, wherever it sits under the page's default scope. */
    private fun videoDetail(root: JSONObject): JSONObject? {
        val scope = root.optJSONObject("__DEFAULT_SCOPE__") ?: return null
        scope.optJSONObject("webapp.video-detail")?.let { return it }
        val key = scope.keys().asSequence().firstOrNull { it.contains("video-detail") }
        return key?.let { scope.optJSONObject(it) }
    }

    /** Last resort: any object in the page that has an id and a video with a play address, found by walking the JSON. */
    private fun findItem(node: Any?, depth: Int = 0): JSONObject? {
        if (depth > 12) return null
        when (node) {
            is JSONObject -> {
                val video = node.optJSONObject("video")
                if (video != null && node.has("id") && (video.has("playAddr") || video.has("bitrateInfo") || video.has("downloadAddr"))) return node
                for (k in node.keys()) findItem(node.opt(k), depth + 1)?.let { return it }
            }
            is JSONArray -> for (i in 0 until node.length()) findItem(node.opt(i), depth + 1)?.let { return it }
        }
        return null
    }

    private val VIDEO_PATH = Regex("/@([A-Za-z0-9._-]+)/video/(\\d+)/?")

    /**
     * The page address TikTok's own web player uses for a video: `https://www.tiktok.com/@user/video/ID`, with no query
     * or fragment. Null for short links (vt., vm.), other hosts, photo posts and anything that is not a video page.
     */
    fun canonicalUrl(finalUrl: String): String? {
        val uri = try {
            java.net.URI(finalUrl.trim())
        } catch (e: Exception) {
            return null
        }
        if (uri.scheme != "https" && uri.scheme != "http") return null
        val host = uri.host?.lowercase() ?: return null
        if (host != "tiktok.com" && !host.endsWith(".tiktok.com")) return null
        if (host.startsWith("vt.") || host.startsWith("vm.")) return null
        val m = VIDEO_PATH.matchEntire(uri.rawPath ?: return null) ?: return null
        return "https://www.tiktok.com/@${m.groupValues[1]}/video/${m.groupValues[2]}"
    }

    /** [url] without its query and fragment, so a log line carries no share parameters. */
    fun withoutQuery(url: String): String = url.substringBefore('#').substringBefore('?')

    /** True once the page holds either a video or a status code, so an interim page (redirect, challenge) is skipped. */
    fun isReady(json: String): Boolean = try {
        val root = JSONObject(json)
        val detail = videoDetail(root)
        (detail?.optInt("statusCode", 0) ?: 0) != 0 || detail?.optJSONObject("itemInfo")?.optJSONObject("itemStruct") != null || findItem(root) != null
    } catch (e: Exception) {
        false
    }

    /** Key names only (no values, so nothing personal), to see why a page held no video. */
    fun shape(json: String): String = try {
        val root = JSONObject(json)
        val scope = root.optJSONObject("__DEFAULT_SCOPE__")
        val detail = videoDetail(root)
        val names = { o: JSONObject? -> o?.keys()?.asSequence()?.toList()?.sorted()?.take(40)?.joinToString(",") ?: "-" }
        "root[${names(root)}] scope[${names(scope)}] detail[${names(detail)}] item[${names(detail?.optJSONObject("itemInfo"))}] status=${detail?.opt("statusCode") ?: "-"} msg=${detail?.optString("statusMsg").orEmpty().take(60)}"
    } catch (e: Exception) {
        "not json (${json.length} chars)"
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
