package app.eqdownload

/** Helpers for the numbers the youtubedl-android library hands to the progress callback. */
object ProgressParser {
    private val SPEED = Regex("""\bat\s+(\d+(?:\.\d+)?)\s*(B|[KMGT]iB)/s""")

    /** Bytes per second from a `[download] ... at 1.50MiB/s ETA ...` line, or null when yt-dlp printed Unknown. */
    fun speedBps(line: String): Long? {
        val m = SPEED.find(line) ?: return null
        val n = m.groupValues[1].toDoubleOrNull() ?: return null
        val mult = when (m.groupValues[2]) {
            "B" -> 1L
            "KiB" -> 1L shl 10
            "MiB" -> 1L shl 20
            "GiB" -> 1L shl 30
            else -> 1L shl 40
        }
        return Math.round(n * mult)
    }

    fun percent(p: Float): Double = p.toDouble().coerceIn(0.0, 100.0)

    fun eta(seconds: Long): Long? = if (seconds < 0) null else seconds
}
