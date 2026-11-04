package app.eqdownload

/**
 * When may DownloadService stop itself? Always through `stopSelf(startId)` with the newest start id seen, so a start
 * the system has queued but not delivered yet (its id is higher) is never stopped by an older request.
 * Main thread only.
 */
class IdlePolicy {
    var pending = 0
        private set
    var lastStartId = 0
        private set

    /** Record a delivered start. [withWork] is true when it brought a download to run. */
    fun started(startId: Int, withWork: Boolean) {
        lastStartId = startId
        if (withWork) pending++
    }

    fun finished() {
        if (pending > 0) pending--
    }

    /** The id to pass to `stopSelf`, or null while downloads remain. */
    fun stopId(): Int? = if (pending == 0) lastStartId else null
}
