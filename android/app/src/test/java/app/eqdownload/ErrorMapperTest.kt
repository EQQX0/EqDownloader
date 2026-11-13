package app.eqdownload

import java.io.IOException
import java.net.UnknownHostException
import org.junit.Assert.assertEquals
import org.junit.Test

class ErrorMapperTest {
    private val cases = listOf(
        "ERROR: Unsupported URL: x" to "unsupported",
        "ERROR: Sign in to confirm you are not a bot" to "blocked",
        "ERROR: [TikTok] 7706848607252565255: This post may not be comfortable for some audiences. Log in for access. Use --cookies-from-browser or --cookies for the authentication." to "blocked",
        "ERROR: This video may be inappropriate for some users. Confirm your age" to "blocked",
        "This video is not available in your country" to "blocked",
        "ERROR: Unable to download webpage: boom" to "network",
        "ERROR: [TikTok] 1: Unable to download webpage: HTTP Error 403: Forbidden (caused by <HTTPError 403: Forbidden>)" to "blocked",
        "ERROR: HTTP Error 403: Forbidden" to "outdated",
        "WARNING: nsig extraction failed" to "outdated",
        "OSError: [Errno 28] No space left on device" to "disk",
        "PermissionError: [Errno 13] Permission denied: '/sdcard/x'" to "disk",
        "ERROR: something else" to "unknown",
        "ERROR: a message was generated" to "unknown",
        "" to "unknown",
    )

    @Test
    fun mapsStderrExactlyLikeDesktop() {
        for ((text, code) in cases) assertEquals(text, code, ErrorMapper.code(text))
    }

    @Test
    fun theFirstMatchingRuleWins() {
        assertEquals("unsupported", ErrorMapper.code("Unsupported URL ... Sign in"))
    }

    @Test
    fun messageIsTheLastErrorLineCapped() {
        val e = ErrorMapper.fromStderr("WARNING: x\nERROR: first\nERROR: Unsupported URL: y\n")
        assertEquals("unsupported", e.code)
        assertEquals("ERROR: Unsupported URL: y", e.message)
        assertEquals(300, ErrorMapper.fromStderr("ERROR: " + "a".repeat(500)).message!!.length)
        assertEquals("yt-dlp failed", ErrorMapper.fromStderr("  \n").message)
    }

    @Test
    fun throwablesMapToCodes() {
        assertEquals("network", ErrorMapper.fromThrowable(UnknownHostException("api.github.com")).code)
        assertEquals("disk", ErrorMapper.fromThrowable(IOException("write failed: ENOSPC (No space left on device)")).code)
        assertEquals("outdated", ErrorMapper.fromThrowable(Exception("ERROR: HTTP Error 403: Forbidden")).code)
        val own = EngineException("blocked", "x")
        assertEquals(own, ErrorMapper.fromThrowable(own))
        assertEquals("unknown", ErrorMapper.fromThrowable(RuntimeException()).code)
    }
}
