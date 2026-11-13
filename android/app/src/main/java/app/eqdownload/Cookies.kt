package app.eqdownload

import java.io.File
import java.net.URI

/** Sites the user can sign in to. Mirrors ui/src/engine/sites.ts. */
enum class Site(val id: String, val label: String, val loginUrl: String, private val hosts: List<String>) {
    INSTAGRAM("instagram", "Instagram", "https://www.instagram.com/accounts/login/", listOf("instagram.com")),
    YOUTUBE(
        "youtube", "YouTube",
        "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F",
        listOf("youtube.com", "youtu.be", "youtube-nocookie.com"),
    ),
    TIKTOK("tiktok", "TikTok", "https://www.tiktok.com/login", listOf("tiktok.com"));

    fun matchesHost(host: String): Boolean {
        val h = host.lowercase()
        return hosts.any { h == it || h.endsWith(".$it") }
    }

    /** Pages whose cookies are saved, with the cookie domain each is written under. */
    val cookieSources: List<Pair<String, String>>
        get() = when (this) {
            INSTAGRAM -> listOf("https://www.instagram.com/" to ".instagram.com")
            TIKTOK -> listOf("https://www.tiktok.com/" to ".tiktok.com")
            YOUTUBE -> listOf(
                "https://www.youtube.com/" to ".youtube.com",
                "https://accounts.google.com/" to ".google.com",
                "https://www.google.com/" to ".google.com",
            )
        }

    companion object {
        fun parse(id: String?): Site? = entries.firstOrNull { it.id == id }

        fun forUrl(url: String): Site? {
            val host = try {
                val u = URI(url)
                if (u.scheme != "http" && u.scheme != "https") return null
                u.host ?: return null
            } catch (e: Exception) {
                return null
            }
            return entries.firstOrNull { it.matchesHost(host) }
        }
    }
}

/** Netscape cookie file, the format yt-dlp's --cookies reads. */
object Netscape {
    private const val YEAR_SECONDS = 365L * 24 * 3600

    private fun clean(s: String) = s.replace(Regex("[\\t\\r\\n]"), "")

    /**
     * Android's CookieManager returns a request header (`a=b; c=d`) with no flags, path or expiry. Each cookie is written
     * for the whole domain over https with a one-year expiry; yt-dlp only needs the names and values.
     */
    fun fromHeader(header: String?, domain: String, nowSec: Long = System.currentTimeMillis() / 1000): List<String> {
        if (header.isNullOrBlank()) return emptyList()
        return header.split(';').mapNotNull { part ->
            val eq = part.indexOf('=')
            if (eq <= 0) return@mapNotNull null
            val name = clean(part.substring(0, eq).trim())
            val value = clean(part.substring(eq + 1).trim())
            if (name.isEmpty()) null else listOf(domain, "TRUE", "/", "TRUE", (nowSec + YEAR_SECONDS).toString(), name, value).joinToString("\t")
        }
    }

    fun file(cookieLines: List<String>): String =
        (listOf("# Netscape HTTP Cookie File", "# Written by EqDownload. Contains sign-in cookies: do not share.", "") + cookieLines)
            .joinToString("\n") + "\n"

    fun hasCookies(text: String): Boolean =
        text.lineSequence().any { it.isNotBlank() && (!it.startsWith("#") || it.startsWith("#HttpOnly_")) }
}

/** Where the per-site cookie files live (the app's private files folder). Set once at start-up. */
object CookieStore {
    @Volatile
    var dir: File? = null

    fun fileFor(site: Site): File? = dir?.let { File(it, "${site.id}.txt") }

    fun has(site: Site): Boolean =
        try {
            fileFor(site)?.takeIf { it.isFile }?.readText()?.let(Netscape::hasCookies) ?: false
        } catch (e: Exception) {
            false
        }

    fun save(site: Site, text: String) {
        val file = fileFor(site) ?: return
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, "${site.id}.txt.tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(file)) {
            file.delete()
            check(tmp.renameTo(file)) { "Could not save the sign-in" }
        }
    }

    fun remove(site: Site) {
        fileFor(site)?.delete()
    }

    /** The cookie file to pass to yt-dlp for this link, or null when the site is unknown or not signed in. */
    fun fileFor(url: String): String? {
        val site = Site.forUrl(url) ?: return null
        return if (has(site)) fileFor(site)?.absolutePath else null
    }
}
