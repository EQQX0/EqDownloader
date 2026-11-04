package app.eqdownload

import java.io.File

/** Removes staging folders left behind by a crash. Only `.eqdl-*` folders older than ten minutes, never an active one. */
object StagingSweeper {
    const val PREFIX = ".eqdl-"
    const val STALE_AFTER_MS = 10 * 60 * 1000L

    fun sweep(
        root: File,
        now: Long = System.currentTimeMillis(),
        maxAgeMs: Long = STALE_AFTER_MS,
        active: Set<String> = emptySet(),
    ): Int {
        val children = root.listFiles() ?: return 0
        var removed = 0
        for (dir in children) {
            if (!dir.isDirectory || !dir.name.startsWith(PREFIX) || dir.name in active) continue
            val newest = dir.walkTopDown().maxOf { it.lastModified() }
            if (newest < now - maxAgeMs && dir.deleteRecursively()) removed++
        }
        return removed
    }
}
