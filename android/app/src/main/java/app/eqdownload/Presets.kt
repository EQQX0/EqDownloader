package app.eqdownload

/** Mirrors `PresetSpec` in ui/src/engine/presets.ts. PresetsTest compares the two tables. */
data class PresetSpec(val format: String, val extractAudio: Boolean, val audioFormat: String?)

object Presets {
    private val SPECS: Map<String, PresetSpec> = linkedMapOf(
        "best" to PresetSpec("bv*+ba/b", false, null),
        "1080p" to PresetSpec("bv*[height<=1080]+ba/b[height<=1080]", false, null),
        "720p" to PresetSpec("bv*[height<=720]+ba/b[height<=720]", false, null),
        "mp3" to PresetSpec("ba/b", true, "mp3"),
        "m4a" to PresetSpec("ba[ext=m4a]/ba/b", true, "m4a"),
    )

    val ALL: List<String> = SPECS.keys.toList()

    /** Throws [IllegalArgumentException] for anything that is not exactly one of the five presets. */
    fun spec(p: String): PresetSpec = SPECS[p] ?: throw IllegalArgumentException("Unknown preset")
}
