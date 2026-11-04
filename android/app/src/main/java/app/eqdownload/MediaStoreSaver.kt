package app.eqdownload

import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import java.io.File
import java.io.IOException

/**
 * Moves a finished file out of app-private staging into `Downloads/EqDownload` through MediaStore.
 * No storage permission is needed for files an app inserts itself (minSdk 29).
 */
object MediaStoreSaver {
    const val RELATIVE_PATH = "Download/EqDownload"
    const val DISPLAY_PATH = "Downloads/EqDownload"

    data class Saved(val uri: Uri, val displayName: String)

    // Names handed out and not yet finished. Pending rows are hidden from plain queries on Android 10,
    // so this keeps two simultaneous saves of the same name apart on every supported version.
    private val reserved = HashSet<String>()
    private val lock = Any()

    fun save(context: Context, file: File, mime: String): Uri = saveNamed(context, file, mime).uri

    fun saveNamed(context: Context, file: File, mime: String): Saved {
        val resolver = context.contentResolver
        val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val (stem, ext) = FileNames.split(file.name)
        val base = FileNames.safe(stem) + if (ext.isEmpty()) "" else ".$ext"

        val uri: Uri
        val name: String
        synchronized(lock) {
            name = FileNames.unique(base) { it in reserved || existsInStore(resolver, collection, it) }
            reserved += name
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, RELATIVE_PATH)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            uri = try {
                resolver.insert(collection, values) ?: throw IOException("MediaStore refused the new file")
            } catch (e: Exception) {
                reserved -= name
                throw ErrorMapper.fromThrowable(e)
            }
        }
        try {
            val out = resolver.openOutputStream(uri) ?: throw IOException("Cannot open the new file")
            out.use { o -> file.inputStream().use { it.copyTo(o, 256 * 1024) } }
            resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
        } catch (e: Exception) {
            runCatching { resolver.delete(uri, null, null) }
            throw ErrorMapper.fromThrowable(e)
        } finally {
            synchronized(lock) { reserved -= name }
        }
        return Saved(uri, name)
    }

    private fun existsInStore(resolver: ContentResolver, collection: Uri, name: String): Boolean {
        val projection = arrayOf(MediaStore.MediaColumns._ID)
        val selection = "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?"
        val args = arrayOf(name, "$RELATIVE_PATH/")
        val cursor = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val b = Bundle().apply {
                putString(ContentResolver.QUERY_ARG_SQL_SELECTION, selection)
                putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, args)
                putInt(MediaStore.QUERY_ARG_MATCH_PENDING, MediaStore.MATCH_INCLUDE)
            }
            resolver.query(collection, projection, b, null)
        } else {
            resolver.query(collection, projection, selection, args, null)
        }
        return cursor?.use { it.count > 0 } ?: false
    }
}
