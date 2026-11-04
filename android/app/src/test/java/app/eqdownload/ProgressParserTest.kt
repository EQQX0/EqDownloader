package app.eqdownload

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ProgressParserTest {
    @Test
    fun speedFromADownloadLine() {
        assertEquals(1_572_864L, ProgressParser.speedBps("[download]  45.0% of 10.00MiB at  1.50MiB/s ETA 00:04"))
        assertEquals(512_000L, ProgressParser.speedBps("[download]   5.0% of 10.00MiB at 500.00KiB/s ETA 00:20"))
        assertEquals(1_000L, ProgressParser.speedBps("[download] 1% of 1MiB at 1000B/s ETA 00:20"))
    }

    @Test
    fun noSpeedWhenUnknown() {
        assertNull(ProgressParser.speedBps("[download] 100% of 10.00MiB in 00:07"))
        assertNull(ProgressParser.speedBps("[download]  45.0% of 10.00MiB at Unknown B/s ETA Unknown"))
        assertNull(ProgressParser.speedBps(""))
    }

    @Test
    fun clampsPercentAndEta() {
        assertEquals(0.0, ProgressParser.percent(-1f), 0.0)
        assertEquals(100.0, ProgressParser.percent(123f), 0.0)
        assertEquals(45.5, ProgressParser.percent(45.5f), 0.0001)
        assertNull(ProgressParser.eta(-1L))
        assertEquals(4L, ProgressParser.eta(4L))
    }

    @Test
    fun speedFromAria2SummaryLine() {
        assertEquals(1_572_864L, ProgressParser.speedBps("[#2089b0 400KiB/33MiB(1%) CN:8 DL:1.5MiB ETA:4m51s]"))
        assertEquals(900L, ProgressParser.speedBps("[#2089b0 1KiB/33MiB(0%) CN:1 DL:900B]"))
    }
}
