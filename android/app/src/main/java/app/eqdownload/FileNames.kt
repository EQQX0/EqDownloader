package app.eqdownload

object FileNames {
    private const val MAX_LEN = 120
    private val ILLEGAL = Regex("[<>:\"/\\\\|?*\\u0000-\\u001f\\u007f]")

    /** Makes a title safe as a file name: illegal and control characters become `_`, cut to 120 characters, never empty. */
    fun safe(title: String, maxLen: Int = MAX_LEN): String {
        val replaced = ILLEGAL.replace(title, "_")
        val cut = if (replaced.codePointCount(0, replaced.length) > maxLen) {
            replaced.substring(0, replaced.offsetByCodePoints(0, maxLen))
        } else {
            replaced
        }
        return cut.trimEnd('.', ' ').trimStart(' ').ifEmpty { "download" }
    }

    /** "a.b.mp4" -> ("a.b", "mp4"); no extension -> ("name", ""). */
    fun split(name: String): Pair<String, String> {
        val i = name.lastIndexOf('.')
        return if (i > 0) name.substring(0, i) to name.substring(i + 1) else name to ""
    }

    /** First of `name`, `name (2).ext`, `name (3).ext`... for which [exists] is false. */
    fun unique(name: String, exists: (String) -> Boolean): String {
        val (stem, ext) = split(name)
        val dot = if (ext.isEmpty()) "" else ".$ext"
        for (n in 1 until 10_000) {
            val candidate = if (n == 1) name else "$stem ($n)$dot"
            if (!exists(candidate)) return candidate
        }
        throw EngineException("unknown", "Could not find a free file name")
    }

    fun mimeFor(ext: String): String = when (ext.lowercase()) {
        "mp4", "m4v" -> "video/mp4"
        "webm" -> "video/webm"
        "mkv" -> "video/x-matroska"
        "mov" -> "video/quicktime"
        "mp3" -> "audio/mpeg"
        "m4a" -> "audio/mp4"
        "opus", "ogg" -> "audio/ogg"
        "aac" -> "audio/aac"
        "wav" -> "audio/wav"
        "flac" -> "audio/flac"
        else -> "application/octet-stream"
    }
}
