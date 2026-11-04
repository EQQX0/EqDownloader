package app.eqdownload

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.webkit.WebViewFeature
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(EqEnginePlugin::class.java)
        super.onCreate(savedInstanceState)
        // Capacitor needs DOCUMENT_START_SCRIPT to inject its bridge without breaking the strict CSP. The web layer
        // shows an update notice when the bridge is missing; this line only leaves a local log (nothing is sent anywhere).
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Log.w("EqDownload", "This WebView lacks DOCUMENT_START_SCRIPT; the app needs an updated Android System WebView.")
        }
        // A recreated activity (savedInstanceState != null) must not replay an old share.
        if (savedInstanceState == null) forwardShare(intent)
    }

    /** The clipboard can only be read while this window has focus, so the app looks exactly then. */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) (bridge?.getPlugin("EqEngine")?.instance as? EqEnginePlugin)?.emitClipboard()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        forwardShare(intent)
    }

    /** "Share to EqDownload": hands the shared text to the web layer, which finds the link in it. */
    private fun forwardShare(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND || intent.type != "text/plain") return
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.take(MAX_SHARED_CHARS) ?: return
        intent.removeExtra(Intent.EXTRA_TEXT)
        val plugin = bridge?.getPlugin("EqEngine")?.instance as? EqEnginePlugin
        plugin?.emitShare(text)
    }

    private companion object {
        const val MAX_SHARED_CHARS = 8000
    }
}
