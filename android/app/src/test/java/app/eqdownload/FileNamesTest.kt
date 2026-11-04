package app.eqdownload

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FileNamesTest {
    @Test
    fun safeReplacesIllegalCharactersAndNeverReturnsEmpty() {
        assertEquals("a_b_c", FileNames.safe("a/b\\c"))
        assertEquals("download", FileNames.safe("   "))
        assertEquals("download", FileNames.safe("..."))
        assertEquals("x_y", FileNames.safe("x\u0000y"))
        assertEquals(120, FileNames.safe("e".repeat(300)).length)
    }

    @Test
    fun uniqueAddsCounterBeforeTheExtension() {
        val taken = mutableSetOf("clip.mp4", "clip (2).mp4")
        assertEquals("clip (3).mp4", FileNames.unique("clip.mp4") { it in taken })
        assertEquals("other.mp4", FileNames.unique("other.mp4") { it in taken })
    }

    @Test
    fun twoSavesOfTheSameNameGetDifferentNames() {
        val taken = mutableSetOf<String>()
        val a = FileNames.unique("same.mp4") { it in taken }.also { taken += it }
        val b = FileNames.unique("same.mp4") { it in taken }.also { taken += it }
        assertTrue(a != b)
    }

    @Test
    fun uniqueWithoutExtension() {
        assertEquals("note (2)", FileNames.unique("note") { it == "note" })
    }

    @Test
    fun mimeByExtension() {
        assertEquals("video/mp4", FileNames.mimeFor("mp4"))
        assertEquals("video/webm", FileNames.mimeFor("WEBM"))
        assertEquals("video/x-matroska", FileNames.mimeFor("mkv"))
        assertEquals("audio/mpeg", FileNames.mimeFor("mp3"))
        assertEquals("audio/mp4", FileNames.mimeFor("m4a"))
        assertEquals("application/octet-stream", FileNames.mimeFor("zzz"))
    }

    @Test
    fun stemAndExtension() {
        assertEquals("a.b" to "mp4", FileNames.split("a.b.mp4"))
        assertEquals("noext" to "", FileNames.split("noext"))
    }
}
