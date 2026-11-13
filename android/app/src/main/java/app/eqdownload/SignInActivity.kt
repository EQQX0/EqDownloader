package app.eqdownload

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Opens a site's own login page in a plain web view. The user types the password into the site, never into this app.
 * Done saves the site's cookies as a Netscape file for yt-dlp; back or Cancel leaves any earlier sign-in alone.
 */
class SignInActivity : Activity() {
    private lateinit var site: Site
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        site = Site.parse(intent.getStringExtra(EXTRA_SITE)) ?: run {
            finish()
            return
        }
        val dp = resources.displayMetrics.density
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#0B132B"))
            setPadding((12 * dp).toInt(), (8 * dp).toInt(), (12 * dp).toInt(), (8 * dp).toInt())
        }
        val title = TextView(this).apply {
            text = "Sign in to ${site.label}"
            setTextColor(Color.WHITE)
            textSize = 16f
        }
        val cancel = Button(this).apply {
            text = "Cancel"
            minimumHeight = (48 * dp).toInt()
            setOnClickListener { finish() }
        }
        val done = Button(this).apply {
            text = "Done"
            minimumHeight = (48 * dp).toInt()
            setOnClickListener { saveAndFinish() }
        }
        bar.addView(title, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        bar.addView(cancel)
        bar.addView(done)

        web = WebView(this)
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(web, true)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            // Google refuses sign-in from a page that calls itself an embedded web view ("; wv"), so present as Chrome.
            userAgentString = userAgentString.replace("; wv", "").replace(Regex(" Version/\\d+\\.\\d+"), "")
        }
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            // Stay on https pages; anything else (intent:, market:, http:) is ignored.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.scheme != "https"
        }

        setContentView(
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
                addView(web, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            },
        )
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(site.loginUrl)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    private fun saveAndFinish() {
        try {
            val manager = CookieManager.getInstance()
            manager.flush()
            val lines = site.cookieSources.flatMap { (page, domain) -> Netscape.fromHeader(manager.getCookie(page), domain) }
            val text = Netscape.file(lines)
            // Keep an earlier sign-in when this window holds no cookies for the site.
            if (Netscape.hasCookies(text)) CookieStore.save(site, text)
        } catch (e: Exception) {
            DebugLog.add("signin", "${site.id} ${e.javaClass.simpleName}: ${e.message?.take(300)}")
        }
        setResult(RESULT_OK)
        finish()
    }

    override fun onDestroy() {
        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_SITE = "site"
    }
}
