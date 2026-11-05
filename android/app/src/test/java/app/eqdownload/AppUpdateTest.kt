package app.eqdownload

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateTest {
    private val base = "https://github.com/EQQX0/EqDownloader/releases/download/v0.1.6/"

    @Test fun trustsOnlyGithubHttpsHosts() {
        assertTrue(AppUpdate.isTrustedHost("https://github.com/EQQX0/EqDownloader/releases/download/v1/x"))
        assertTrue(AppUpdate.isTrustedHost("https://api.github.com/repos/x"))
        assertTrue(AppUpdate.isTrustedHost("https://objects.githubusercontent.com/abc?sig=1"))
        assertTrue(AppUpdate.isTrustedHost("https://release-assets.githubusercontent.com/a"))
    }

    @Test fun rejectsUntrustedRedirectTargets() {
        assertFalse(AppUpdate.isTrustedHost("http://github.com/x"))
        assertFalse(AppUpdate.isTrustedHost("https://example.com/x"))
        assertFalse(AppUpdate.isTrustedHost("https://github.com.evil.test/x"))
        assertFalse(AppUpdate.isTrustedHost("https://evilgithub.com/x"))
        assertFalse(AppUpdate.isTrustedHost("https://evilgithubusercontent.com/x"))
        assertFalse(AppUpdate.isTrustedHost("https://githubusercontent.com.evil.test/x"))
        assertFalse(AppUpdate.isTrustedHost("https://user@evil.test@github.com/x"))
        assertFalse(AppUpdate.isTrustedHost("not a url"))
        assertFalse(AppUpdate.isTrustedHost("file:///etc/passwd"))
    }

    @Test fun refusesAReleaseThatIsNotNewer() {
        AppUpdate.requireNewer("0.1.6", "0.1.5")
        assertThrows(IllegalStateException::class.java) { AppUpdate.requireNewer("0.1.5", "0.1.5") }
        assertThrows(IllegalStateException::class.java) { AppUpdate.requireNewer("0.1.4", "0.1.5") }
        assertThrows(IllegalStateException::class.java) { AppUpdate.requireNewer("0.1.6", "garbage") }
    }

    @Test fun comparesVersions() {
        assertTrue(AppUpdate.isNewer("v0.1.6", "0.1.5"))
        assertTrue(AppUpdate.isNewer("0.2.0", "0.1.9"))
        assertFalse(AppUpdate.isNewer("v0.1.5", "0.1.5"))
        assertFalse(AppUpdate.isNewer("v0.1.4", "0.1.5"))
        assertFalse(AppUpdate.isNewer("latest", "0.1.5"))
    }

    @Test fun parsesPlainVersionsOnly() {
        assertEquals(listOf(0, 1, 5), AppUpdate.parseVersion("v0.1.5"))
        assertNull(AppUpdate.parseVersion("0.1"))
        assertNull(AppUpdate.parseVersion("1.2.3-beta"))
    }

    @Test fun readsTheApkLink() {
        val json = """{"tag_name":"v0.1.6","assets":[
            {"name":"EqDownload.exe","browser_download_url":"${base}EqDownload.exe"},
            {"name":"EqDownload.apk","browser_download_url":"${base}EqDownload.apk"}]}"""
        val r = AppUpdate.parseRelease(json)
        assertEquals("0.1.6", r.version)
        assertEquals("${base}EqDownload.apk", r.apkUrl)
    }

    @Test fun refusesAnApkLinkOnAnotherHost() {
        val json = """{"tag_name":"v0.1.6","assets":[{"name":"EqDownload.apk","browser_download_url":"https://evil.example/EqDownload.apk"}]}"""
        assertThrows(IllegalArgumentException::class.java) { AppUpdate.parseRelease(json) }
    }

    @Test fun refusesAReleaseWithoutAnApk() {
        assertThrows(IllegalStateException::class.java) { AppUpdate.parseRelease("""{"tag_name":"v0.1.6","assets":[]}""") }
    }

    @Test
    fun readsTheApkHashFromSha256Sums() {
        val h = "a".repeat(64)
        val other = "b".repeat(64)
        val sums = "$other  EqDownload.exe\n$h  EqDownload.apk\n"
        assertEquals(h, AppUpdate.expectedHash(sums))
        assertEquals(null, AppUpdate.expectedHash("$other  EqDownload.exe\n"))
        assertEquals(h, AppUpdate.expectedHash(h.uppercase() + " *EqDownload.apk"))
    }

    @Test
    fun hashesAFile() {
        val f = java.io.File.createTempFile("eqtest", ".bin")
        try {
            f.writeText("abc")
            assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", AppUpdate.sha256(f))
        } finally {
            f.delete()
        }
    }
}
