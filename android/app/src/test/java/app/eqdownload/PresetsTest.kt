package app.eqdownload

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class PresetsTest {
    @Test
    fun fiveSpecsMatchTheSharedPresets() {
        assertEquals(PresetSpec("bv*+ba/b", false, null), Presets.spec("best"))
        assertEquals(PresetSpec("bv*[height<=1080]+ba/b[height<=1080]", false, null), Presets.spec("1080p"))
        assertEquals(PresetSpec("bv*[height<=720]+ba/b[height<=720]", false, null), Presets.spec("720p"))
        assertEquals(PresetSpec("ba/b", true, "mp3"), Presets.spec("mp3"))
        assertEquals(PresetSpec("ba[ext=m4a]/ba/b", true, "m4a"), Presets.spec("m4a"))
    }

    @Test
    fun onlyTheFivePresetsExist() {
        assertEquals(listOf("best", "1080p", "720p", "mp3", "m4a"), Presets.ALL)
    }

    @Test
    fun unknownPresetThrows() {
        for (bad in listOf("", "BEST", "4k", "best; rm -rf /", "-x", " best")) {
            try {
                Presets.spec(bad)
                fail("expected a throw for '$bad'")
            } catch (_: IllegalArgumentException) {
                // expected
            }
        }
    }

    /** Guards against drift from ui/src/engine/presets.ts, the source of truth. */
    @Test
    fun matchesTheTypeScriptTable() {
        val ts = File("../../ui/src/engine/presets.ts")
        assertTrue("cannot find ${ts.absolutePath}", ts.exists())
        val row = Regex("""'?(\w+)'?:\s*\{\s*format:\s*'([^']+)',\s*extractAudio:\s*(true|false),\s*audioFormat:\s*(null|'(\w+)')""")
        val found = row.findAll(ts.readText()).associate {
            it.groupValues[1] to PresetSpec(it.groupValues[2], it.groupValues[3] == "true", it.groupValues[5].ifEmpty { null })
        }
        assertEquals(Presets.ALL.toSet(), found.keys)
        for ((name, spec) in found) assertEquals(name, spec, Presets.spec(name))
        assertNull(found.getValue("best").audioFormat)
        assertFalse(found.getValue("720p").extractAudio)
    }
}
