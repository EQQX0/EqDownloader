package app.eqdownload

import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * A plain-text log kept on the device so a failed download can be traced: the command that ran, what yt-dlp
 * printed, and the error. It never leaves the phone unless the user copies it from Settings.
 * The file is cut to its newest half when it grows past [max] characters.
 */
object DebugLog {
    private var file: File? = null
    private var max = 200_000
    private val PROGRESS = Regex("""^\s*(\[#\w+ |\[download]\s+\d+(\.\d)?%)""")

    @Synchronized
    fun init(f: File, maxChars: Int = 200_000) {
        file = f
        max = maxChars
    }

    /** True for the once-a-second progress lines, which would drown out everything else. */
    fun isProgressLine(line: String): Boolean = PROGRESS.containsMatchIn(line)

    @Synchronized
    fun add(tag: String, message: String) {
        val f = file ?: return
        try {
            val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
            f.appendText("$stamp [$tag] ${message.trimEnd()}\n")
            if (f.length() > max) {
                val keep = f.readText().takeLast(max / 2)
                f.writeText(keep.substringAfter('\n', keep))
            }
        } catch (_: Throwable) {
            // Logging must never break a download.
        }
    }

    @Synchronized
    fun read(): String = try { file?.takeIf { it.exists() }?.readText().orEmpty() } catch (_: Throwable) { "" }

    @Synchronized
    fun clear() {
        try { file?.delete() } catch (_: Throwable) { }
    }

    /** True when a failure came from the bundled aria2c downloader (as opposed to the site or the network). */
    fun isAria2Failure(t: Throwable): Boolean = t.message?.contains("aria2", ignoreCase = true) == true
}
