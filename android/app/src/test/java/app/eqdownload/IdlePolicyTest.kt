package app.eqdownload

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class IdlePolicyTest {
    @Test
    fun staysUpWhileADownloadRuns() {
        val p = IdlePolicy()
        p.started(1, withWork = true)
        assertNull(p.stopId())
    }

    @Test
    fun stopsWithTheNewestStartIdWhenTheLastDownloadEnds() {
        val p = IdlePolicy()
        p.started(1, withWork = true)
        p.started(2, withWork = true)
        p.finished()
        assertNull(p.stopId())
        p.finished()
        assertEquals(2, p.stopId())
    }

    @Test
    fun aLaterStartRaisesTheIdSoAnOlderStopCannotKillIt() {
        val p = IdlePolicy()
        p.started(1, withWork = true)
        p.started(3, withWork = true) // delivered before the first one finished
        p.finished()
        p.finished()
        assertEquals(3, p.stopId())
    }

    @Test
    fun aStartWithoutWorkStillRecordsItsIdAndMayStop() {
        val p = IdlePolicy()
        p.started(5, withWork = false)
        assertEquals(5, p.stopId())
    }

    @Test
    fun finishedNeverGoesNegative() {
        val p = IdlePolicy()
        p.finished()
        assertEquals(0, p.pending)
    }
}
