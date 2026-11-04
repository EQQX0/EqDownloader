package app.eqdownload

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class YtDlpArgsTest {
    @Test
    fun acceptsHttpsAndUpgradesHttp() {
        assertEquals("https://example.test/v?x=1", UrlGuard.requireHttpUrl("https://example.test/v?x=1"))
        assertEquals("https://example.test/v", UrlGuard.requireHttpUrl("http://example.test/v"))
        assertEquals("https://example.test/a?u=http://x.test", UrlGuard.requireHttpUrl("HTTP://example.test/a?u=http://x.test"))
    }

    @Test
    fun rejectsEverythingElseAsUnsupported() {
        val bad = listOf(
            null, "", "   ", "not a url", "file:///sdcard/x", "content://media/x", "javascript:alert(1)",
            "ftp://x.test/a", "--exec=id", "-o /sdcard/x", "https://", "https://x.test/a b", "https://x.test/\nboom",
            "h".repeat(9000),
        )
        for (b in bad) {
            try {
                UrlGuard.requireHttpUrl(b)
                fail("expected rejection of '$b'")
            } catch (e: EngineException) {
                assertEquals("unsupported", e.code)
            }
        }
    }

    @Test
    fun downloadPutsTheUrlLastAfterDoubleDash() {
        val spec = YtDlpArgs.download("https://example.test/v", "720p", "/data/staging/x")
        val cmd = spec.commandLine()
        assertEquals("https://example.test/v", cmd.last())
        assertEquals("--", cmd[cmd.size - 2])
        assertEquals(1, cmd.count { it == "--" })
        assertFalse(spec.options.any { it.first == "https://example.test/v" || it.second == "https://example.test/v" })
    }

    @Test
    fun aDashLeadingUrlCannotBecomeAnOption() {
        try {
            YtDlpArgs.download("--exec=id", "best", "/x")
            fail("expected a throw")
        } catch (_: EngineException) {
            // rejected before it can reach the command line
        }
    }

    @Test
    fun downloadUsesPresetAndStagingDirOnly() {
        val m = YtDlpArgs.download("https://example.test/v", "720p", "/data/staging/x").options.toMap()
        assertEquals("bv*[height<=720]+ba/b[height<=720]", m["-f"])
        assertEquals("/data/staging/x", m["-P"])
        assertTrue(m.containsKey("--no-playlist"))
        assertFalse(m.containsKey("-x"))
    }

    @Test
    fun audioPresetsExtract() {
        val mp3 = YtDlpArgs.download("https://example.test/v", "mp3", "/s").options
        assertTrue(mp3.contains("-x" to null))
        assertTrue(mp3.contains("--audio-format" to "mp3"))
        val m4a = YtDlpArgs.download("https://example.test/v", "m4a", "/s").options
        assertTrue(m4a.contains("--audio-format" to "m4a"))
    }

    @Test
    fun unknownPresetIsRejected() {
        try {
            YtDlpArgs.download("https://example.test/v", "hax", "/s")
            fail("expected a throw")
        } catch (_: IllegalArgumentException) {
            // expected
        }
    }

    @Test
    fun httpIsUpgradedEverywhere() {
        assertEquals("https://example.test/v", YtDlpArgs.download("http://example.test/v", "best", "/s").url)
        assertEquals("https://example.test/v", YtDlpArgs.probe("http://example.test/v").url)
    }

    @Test
    fun probeAlsoEndsWithDoubleDashUrl() {
        val cmd = YtDlpArgs.probe("https://example.test/v").commandLine()
        assertEquals(listOf("--", "https://example.test/v"), cmd.takeLast(2))
        assertTrue(cmd.contains("--no-playlist"))
    }
}
