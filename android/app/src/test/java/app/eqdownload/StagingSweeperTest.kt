package app.eqdownload

import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class StagingSweeperTest {
    private lateinit var root: File
    private val now = 1_000_000_000_000L

    @Before
    fun setUp() {
        root = Files.createTempDirectory("eqstage").toFile()
    }

    @After
    fun tearDown() {
        root.deleteRecursively()
    }

    private fun dir(name: String, ageMs: Long): File =
        File(root, name).also {
            it.mkdirs()
            File(it, "f.part").apply {
                writeText("x")
                setLastModified(now - ageMs)
            }
            it.setLastModified(now - ageMs)
        }

    @Test
    fun removesOnlyStaleStagingFolders() {
        val old = dir(".eqdl-old", 11 * 60_000L)
        val fresh = dir(".eqdl-fresh", 9 * 60_000L)
        val foreign = dir("keep-me", 60 * 60_000L)
        val removed = StagingSweeper.sweep(root, now)
        assertFalse(old.exists())
        assertTrue(fresh.exists())
        assertTrue("never touches folders it did not create", foreign.exists())
        assertEquals(1, removed)
    }

    @Test
    fun neverRemovesAnActiveFolder() {
        val active = dir(".eqdl-live", 60 * 60_000L)
        StagingSweeper.sweep(root, now, active = setOf(active.name))
        assertTrue(active.exists())
    }

    @Test
    fun missingRootIsFine() {
        assertEquals(0, StagingSweeper.sweep(File(root, "nope"), now))
    }
}
