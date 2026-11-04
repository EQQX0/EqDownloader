package app.eqdownload

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.w3c.dom.Document
import org.w3c.dom.Element

private const val NS = "http://schemas.android.com/apk/res/android"

private fun parse(f: File): Document {
    assertTrue("missing ${f.absolutePath}", f.exists())
    val factory = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
    return factory.newDocumentBuilder().parse(f)
}

private fun Element.attr(name: String): String? = getAttributeNS(NS, name).ifEmpty { null }

private fun Document.permissions(): Set<String> =
    getElementsByTagName("uses-permission").let { l ->
        (0 until l.length).map { (l.item(it) as Element).attr("name")!! }.toSet()
    }

private fun Document.components(): List<Element> =
    listOf("activity", "activity-alias", "service", "receiver", "provider").flatMap { tag ->
        getElementsByTagName(tag).let { l -> (0 until l.length).map { l.item(it) as Element } }
    }

class ManifestTest {
    private val source = parse(File("src/main/AndroidManifest.xml"))
    private val application = source.getElementsByTagName("application").item(0) as Element

    @Test
    fun permissionsAreExactlyTheFour() {
        assertEquals(
            setOf(
                "android.permission.INTERNET",
                "android.permission.FOREGROUND_SERVICE",
                "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
                "android.permission.POST_NOTIFICATIONS",
            ),
            source.permissions(),
        )
    }

    @Test
    fun cleartextAndBackupAreOff() {
        assertEquals("false", application.attr("usesCleartextTraffic"))
        assertEquals("false", application.attr("allowBackup"))
    }

    @Test
    fun networkSecurityConfigBlocksCleartext() {
        assertEquals("@xml/network_security_config", application.attr("networkSecurityConfig"))
        val nsc = parse(File("src/main/res/xml/network_security_config.xml"))
        val base = nsc.getElementsByTagName("base-config").item(0) as Element
        assertEquals("false", base.getAttribute("cleartextTrafficPermitted"))
        assertEquals("no domain may opt back in", 0, nsc.getElementsByTagName("domain-config").length)
        assertEquals("no extra trust anchors", 0, nsc.getElementsByTagName("certificates").length)
    }

    @Test
    fun onlyMainActivityIsExportedAndTheServiceIsNot() {
        val exported = source.components().filter { it.attr("exported") == "true" }
        assertEquals(listOf(".MainActivity"), exported.map { it.attr("name") })
        val service = source.components().single { it.tagName == "service" }
        assertEquals("false", service.attr("exported"))
        assertEquals("dataSync", service.attr("foregroundServiceType"))
    }

    @Test
    fun mainActivityHasLauncherAndTextShareFilters() {
        val main = source.components().single { it.attr("name") == ".MainActivity" }
        val actionNodes = main.getElementsByTagName("action")
        val actions = (0 until actionNodes.length).map { (actionNodes.item(it) as Element).attr("name") }
        assertTrue(actions.contains("android.intent.action.MAIN"))
        assertTrue(actions.contains("android.intent.action.SEND"))
        val data = main.getElementsByTagName("data")
        assertEquals(1, data.length)
        assertEquals("text/plain", (data.item(0) as Element).attr("mimeType"))
    }

    @Test
    fun noPackageVisibilityOrFeatureDeclarations() {
        assertEquals(0, source.getElementsByTagName("queries").length)
        assertEquals(0, source.getElementsByTagName("uses-feature").length)
    }

    /** The manifest the APK really gets. Library manifests may add permissions; those must be removed or justified. */
    @Test
    fun mergedManifestAddsNothingUnexpected() {
        val dir = System.getProperty("eq.mergedManifest")
        assumeTrue("no build dir given", dir != null)
        val merged = File(dir, "intermediates/merged_manifests/debug/processDebugManifest/AndroidManifest.xml")
        assumeTrue("merged manifest not generated yet", merged.exists())
        val doc = parse(merged)
        // androidx.core adds this self-defined, signature-level permission for its non-exported receiver helper.
        val allowed = source.permissions() + "app.eqdownload.android.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"
        assertEquals(allowed, doc.permissions())
        val exported = doc.components().filter { it.attr("exported") == "true" }.map { it.attr("name") }
        assertEquals(listOf("app.eqdownload.MainActivity"), exported)
    }
}
