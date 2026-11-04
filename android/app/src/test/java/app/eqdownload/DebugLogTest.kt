package app.eqdownload

import java.io.File
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
    fun recognisesProgressNoiseAndAria2Failures() {
        assertTrue(DebugLog.isProgressLine("[#2089b0 400KiB/33MiB(1%) CN:8 DL:1.5MiB ETA:4m51s]"))
        assertTrue(DebugLog.isProgressLine("[download]  45.0% of 10.00MiB at 1.50MiB/s ETA 00:04"))
        assertFalse(DebugLog.isProgressLine("ERROR: aria2c exited with code 1"))
        assertTrue(DebugLog.isAria2Failure(RuntimeException("ERROR: aria2c exited with code 1")))
        assertFalse(DebugLog.isAria2Failure(RuntimeException("Sign in to confirm")))
    }
}
