package app.eqdownload

import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.URI
import java.net.UnknownHostException

/** An error the UI understands: [code] is one of the TypeScript `EngineErrorCode` values. */
class EngineException(val code: String, message: String) : Exception(message)

object ErrorMapper {
    private val UNSUPPORTED = Regex("Unsupported URL", RegexOption.IGNORE_CASE)
    private val BLOCKED = Regex("""Sign in|\bage\b|not available in your country""", RegexOption.IGNORE_CASE)
    private val NETWORK = Regex("Unable to download webpage", RegexOption.IGNORE_CASE)
    private val OUTDATED = Regex("HTTP Error 403|nsig", RegexOption.IGNORE_CASE)
    private val DISK = Regex("No space left|Permission denied", RegexOption.IGNORE_CASE)

    /** Same rules, same order as `mapStderr` in desktop/src/main/ytdlp.ts. */
    fun code(stderr: String): String = when {
        UNSUPPORTED.containsMatchIn(stderr) -> "unsupported"
        BLOCKED.containsMatchIn(stderr) -> "blocked"
        NETWORK.containsMatchIn(stderr) -> "network"
        OUTDATED.containsMatchIn(stderr) -> "outdated"
        DISK.containsMatchIn(stderr) -> "disk"
        else -> "unknown"
    }

    fun fromStderr(stderr: String): EngineException {
        val lines = stderr.lines().map { it.trim() }.filter { it.isNotEmpty() }
        val msg = lines.lastOrNull { it.startsWith("ERROR") } ?: lines.lastOrNull() ?: "yt-dlp failed"
        return EngineException(code(stderr), msg.take(300))
    }

    /** Maps anything thrown by the library, the file system or the network to an error the UI can show. */
    fun fromThrowable(t: Throwable): EngineException = when {
        t is EngineException -> t
        t is UnknownHostException || t is ConnectException || t is SocketTimeoutException ->
            EngineException("network", "No network connection.")
        t is IOException && code(t.message.orEmpty()) == "disk" ->
            EngineException("disk", if (t.message.orEmpty().contains("Permission denied", true)) "Permission denied." else "No space left on the device.")
        else -> fromStderr(t.message.orEmpty())
    }
}

/**
 * Every URL from JavaScript is untrusted. Only http(s) links with a host get through, and http is upgraded to https,
 * so probe, start and the yt-dlp arguments only ever see https. (Partial: yt-dlp may still follow a redirect or a
 * manifest to http://.)
 */
object UrlGuard {
    private const val MAX_LENGTH = 4096

    fun requireHttpUrl(raw: String?): String {
        val url = raw?.trim().orEmpty()
        val ok = url.isNotEmpty() && url.length <= MAX_LENGTH && url.none { it.isWhitespace() || it.isISOControl() } &&
            try {
                val u = URI(url)
                (u.scheme.equals("http", true) || u.scheme.equals("https", true)) && !u.host.isNullOrEmpty()
            } catch (_: Exception) {
                false
            }
        if (!ok) throw EngineException("unsupported", "Not a supported link")
        return if (url.startsWith("http://", ignoreCase = true)) "https://" + url.substring(7) else url
    }
}
