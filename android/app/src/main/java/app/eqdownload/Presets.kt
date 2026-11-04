package app.eqdownload

/** Mirrors `PresetSpec` in ui/src/engine/presets.ts. PresetsTest compares the two tables. */
data class PresetSpec(val format: String, val extractAudio: Boolean, val audioFormat: String?)

object Presets {
    private val SPECS: Map<String, PresetSpec> = linkedMapOf(
        "best" to PresetSpec("bv*[format_note!*=?watermark]+ba/b[format_note!*=?watermark]", false, null),
        "1080p" to PresetSpec("bv*[height<=1080][format_note!*=?watermark]+ba/b[height<=1080][format_note!*=?watermark]", false, null),
        "720p" to PresetSpec("bv*[height<=720][format_note!*=?watermark]+ba/b[height<=720][format_note!*=?watermark]", false, null),
        "mp3" to PresetSpec("ba/b[format_note!*=?watermark]", true, "mp3"),
        "m4a" to PresetSpec("ba[ext=m4a]/ba/b[format_note!*=?watermark]", true, "m4a"),
    )

    val ALL: List<String> = SPECS.keys.toList()

    /** Throws [IllegalArgumentException] for anything that is not exactly one of the five presets. */
    fun spec(p: String): PresetSpec = SPECS[p] ?: throw IllegalArgumentException("Unknown preset")
}
