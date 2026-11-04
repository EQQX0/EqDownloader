package app.eqdownload

/**
 * yt-dlp arguments as option/value pairs (the library's request builder takes them that way) plus the URL,
 * which is always passed last, after `--`, so it can never be read as an option.
 */
data class CommandSpec(val options: List<Pair<String, String?>>, val url: String) {
    fun commandLine(): List<String> =
        options.flatMap { (k, v) -> if (v == null) listOf(k) else listOf(k, v) } + listOf("--", url)
}

object YtDlpArgs {
    const val OUTPUT_TEMPLATE = "%(title).120B [%(id)s].%(ext)s"

    fun download(url: String, preset: String, outDir: String): CommandSpec {
        val safeUrl = UrlGuard.requireHttpUrl(url)
        val spec = Presets.spec(preset)
        val options = mutableListOf<Pair<String, String?>>(
            "--newline" to null,
            "--no-colors" to null,
            "--no-playlist" to null,
            // Parallel fragments and 10 MB ranges: faster, and avoids per-connection throttling.
            "-N" to "4",
            "--http-chunk-size" to "10M",
            "--windows-filenames" to null,
            "-f" to spec.format,
            "-P" to outDir,
            "-o" to OUTPUT_TEMPLATE,
        )
        if (spec.extractAudio && spec.audioFormat != null) {
            options += "-x" to null
            options += "--audio-format" to spec.audioFormat
        }
        return CommandSpec(options, safeUrl)
    }

    /** The library adds `--dump-json` itself. */
    fun probe(url: String): CommandSpec =
        CommandSpec(
            listOf(
                "--no-playlist" to null,
                "--no-warnings" to null,
                // The format lists are not shown, so skip fetching the HLS and DASH ones: about 40% faster on YouTube.
                "--extractor-args" to "youtube:skip=translated_subs,hls,dash",
            ),
            UrlGuard.requireHttpUrl(url),
        )
}
