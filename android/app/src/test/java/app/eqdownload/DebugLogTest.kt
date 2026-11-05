package app.eqdownload

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DebugLogTest {
    private fun tmp(): File = File.createTempFile("eqtest", ".log").also { it.delete() }

    @Test
    fun keepsEntriesAndClears() {
        DebugLog.init(tmp())
        DebugLog.add("error", "aria2c exited with code 1")
        assertTrue(DebugLog.read().contains("[error] aria2c exited with code 1"))
        DebugLog.clear()
        assertTrue(DebugLog.read().isEmpty())
    }

    @Test
    fun staysUnderTheLimitAndKeepsTheNewest() {
        DebugLog.init(tmp(), 400)
        repeat(50) { DebugLog.add("line", "entry-$it") }
        val text = DebugLog.read()
        assertTrue(text.length <= 400)
        assertTrue(text.contains("entry-49"))
        assertFalse(text.contains("entry-0\n"))
    }

    @Test
    fun redactsQueryAndFragmentFromUrls() {
        assertEquals("see https://host/path?… now", DebugLog.redactUrls("see https://host/path?x=y#z now"))
        assertEquals("https://host/path?…", DebugLog.redactUrls("https://host/path#frag"))
        assertEquals("https://host/path", DebugLog.redactUrls("https://host/path"))
        assertEquals("no url here", DebugLog.redactUrls("no url here"))
        val line = "[youtube] Downloading webpage https://a.test/v?sig=SECRET&t=1 then http://b.test/x?token=ABC#t=5 done"
        val out = DebugLog.redactUrls(line)
        assertFalse(out.contains("SECRET") || out.contains("ABC") || out.contains("t=5"))
        assertTrue(out.contains("https://a.test/v?…") && out.contains("http://b.test/x?…"))
    }

    @Test
    fun addRedactsUrlsInCommandLinesAndLongOutput() {
        DebugLog.init(tmp())
        DebugLog.add("start", "id1 aria2c https://v.test/a?X-Sig=SECRET yt-dlp -o out --add-header Referer:https://r.test/p?k=SECRET2")
        DebugLog.add("yt-dlp", "x".repeat(300) + " https://cdn.test/seg?token=SECRET3&e=1 " + "y".repeat(100))
        val text = DebugLog.read()
        assertFalse(text.contains("SECRET"))
        assertTrue(text.contains("https://v.test/a?…"))
        assertTrue(text.contains("https://cdn.test/seg?…"))
    }

    @Test
    fun recognisesProgressNoiseAndAria2Failures() {
        assertTrue(DebugLog.isProgressLine("[#2089b0 400KiB/33MiB(1%) CN:8 DL:1.5MiB ETA:4m51s]"))
        assertTrue(DebugLog.isProgressLine("[download]  45.0% of 10.00MiB at 1.50MiB/s ETA 00:04"))
        assertFalse(DebugLog.isProgressLine("ERROR: aria2c exited with code 1"))
        assertTrue(DebugLog.isAria2Failure(RuntimeException("ERROR: aria2c exited with code 1")))
        assertFalse(DebugLog.isAria2Failure(RuntimeException("Sign in to confirm")))
    }
}
