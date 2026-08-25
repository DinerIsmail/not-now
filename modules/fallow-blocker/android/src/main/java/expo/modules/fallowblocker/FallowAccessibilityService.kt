package expo.modules.fallowblocker

import android.accessibilityservice.AccessibilityService
import android.content.SharedPreferences
import android.os.SystemClock
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * The enforcement half of the module. Entirely Android-specific: iOS offers
 * no way to observe or act on another app's UI. Its declaration lives in
 * this module's AndroidManifest.xml; its behaviour (which events we get,
 * whether view IDs are reported) is configured in
 * res/xml/fallow_accessibility_service.xml.
 *
 * Flow: window changes anywhere on the device → onAccessibilityEvent →
 * package name matches a rule? → does the window contain one of the rule's
 * view IDs / content descriptions? → global Back.
 */
class FallowAccessibilityService : AccessibilityService() {

  private var rules: List<BlockRule> = emptyList()
  private var blockedApps: Set<String> = emptySet()
  private var blockedWebsites: Set<String> = emptySet()

  // Last time we pressed Back for a blocked website. Content-changed events
  // arrive in bursts while a page loads; without a cooldown one blocked
  // page would trigger a volley of Back presses that then eats the pages
  // *behind* it too.
  private var lastWebsiteBackAt = 0L

  // Re-read whenever JS saves a change (blocklist edits apply on the next
  // app launch, picker changes immediately) without the user having to
  // re-toggle the service.
  private val prefsListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
    when (key) {
      BlocklistStore.KEY_RULES -> {
        rules = BlocklistStore.load(this)
        Log.i(TAG, "Blocklist reloaded: ${rules.size} rule(s)")
      }
      BlocklistStore.KEY_BLOCKED_APPS -> {
        blockedApps = BlocklistStore.loadBlockedApps(this)
        Log.i(TAG, "Blocked apps reloaded: ${blockedApps.size} app(s)")
      }
      BlocklistStore.KEY_BLOCKED_WEBSITES -> {
        blockedWebsites = BlocklistStore.loadBlockedWebsites(this)
        Log.i(TAG, "Blocked websites reloaded: ${blockedWebsites.size} domain(s)")
      }
    }
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    rules = BlocklistStore.load(this)
    blockedApps = BlocklistStore.loadBlockedApps(this)
    blockedWebsites = BlocklistStore.loadBlockedWebsites(this)
    BlocklistStore.prefs(this).registerOnSharedPreferenceChangeListener(prefsListener)
    Log.i(
      TAG,
      "Service connected, ${rules.size} rule(s), ${blockedApps.size} blocked app(s), " +
        "${blockedWebsites.size} blocked website(s)"
    )
  }

  override fun onDestroy() {
    BlocklistStore.prefs(this).unregisterOnSharedPreferenceChangeListener(prefsListener)
    super.onDestroy()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent) {
    val packageName = event.packageName?.toString() ?: return

    // Belt-and-braces: never act on our own app, whatever the stored state
    // says — otherwise a bad blocklist could lock the user out of the very
    // screen they need to fix it.
    if (packageName == this.packageName) return

    when (event.eventType) {
      // The foreground window/activity changed: run everything.
      AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
        if (handleBlockedApp(packageName)) return
        if (handleBlockedWebsite(packageName)) return
        handleScreenRules(packageName)
      }
      // Content changed inside the current window. Navigating within a
      // browser never changes windows, so this is the only signal that the
      // URL changed. Fires very frequently — bail out immediately for
      // anything that isn't a known browser, and don't run the app/screen
      // handlers here to keep their semantics (and cost) unchanged.
      AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
        if (BROWSER_URL_BARS.containsKey(packageName)) {
          handleBlockedWebsite(packageName)
        }
      }
    }
  }

  // Whole-app blocks need no window inspection. Home, not Back: Back from
  // inside an app just walks up its own screen stack, making the service
  // fire again on every step.
  private fun handleBlockedApp(packageName: String): Boolean {
    if (!blockedApps.contains(packageName)) return false
    Log.i(TAG, "Blocked app $packageName opened, performing Home")
    performGlobalAction(GLOBAL_ACTION_HOME)
    return true
  }

  // Reads the browser's URL bar and presses Back if its host matches a
  // blocked domain (exact or subdomain). Back rather than Home: in a
  // browser, Back is page-level — it returns to the previous page instead
  // of throwing the user out of the whole browser.
  private fun handleBlockedWebsite(packageName: String): Boolean {
    if (blockedWebsites.isEmpty()) return false
    val urlBarId = BROWSER_URL_BARS[packageName] ?: return false
    val root = rootInActiveWindow ?: return false
    val urlBar = root.findAccessibilityNodeInfosByViewId(urlBarId)?.firstOrNull() ?: return false

    // A focused URL bar means the user is typing in it; the text is a
    // half-finished query, not a visited page. Acting on it would fight
    // the keyboard.
    if (urlBar.isFocused) return false

    val host = hostOf(urlBar.text?.toString() ?: return false) ?: return false
    val isBlocked = blockedWebsites.any { host == it || host.endsWith(".$it") }
    if (!isBlocked) return false

    val now = SystemClock.uptimeMillis()
    if (now - lastWebsiteBackAt >= WEBSITE_BACK_COOLDOWN_MS) {
      lastWebsiteBackAt = now
      Log.i(TAG, "Blocked website $host in $packageName, performing Back")
      performGlobalAction(GLOBAL_ACTION_BACK)
    }
    // Still "handled" during the cooldown window — the page is blocked
    // either way.
    return true
  }

  private fun handleScreenRules(packageName: String) {
    val matching = rules.filter { it.packageName == packageName }
    if (matching.isEmpty()) return

    // rootInActiveWindow is the full window tree; event.source is often null
    // or just the changed subtree, so the root is the reliable place to look.
    val root = rootInActiveWindow ?: return

    for (rule in matching) {
      if (windowMatches(root, rule)) {
        Log.i(TAG, "Blocked screen in $packageName, performing Back")
        performGlobalAction(GLOBAL_ACTION_BACK)
        return
      }
    }
  }

  // Extracts a host from URL-bar text. Browsers usually hide the scheme
  // ("m.youtube.com/watch?v=…"), and the bar can also hold a search phrase —
  // anything with spaces or without a dot is rejected as not-a-URL.
  private fun hostOf(rawText: String): String? {
    val raw = rawText.trim().lowercase()
    if (raw.isEmpty() || raw.contains(' ') || !raw.contains('.')) return null
    return raw
      .substringAfter("://") // no-op when there is no scheme
      .substringBefore('/')
      .substringBefore(':') // strip a port if present
      .takeIf { it.isNotEmpty() }
  }

  override fun onInterrupt() {
    // Called when the system wants feedback interrupted (e.g. speech).
    // We produce no ongoing feedback, so there is nothing to stop.
  }

  private fun windowMatches(root: AccessibilityNodeInfo, rule: BlockRule): Boolean {
    // View IDs first: the framework indexes these, so lookup is cheap and
    // doesn't require walking the tree ourselves.
    for (viewId in rule.viewIds) {
      val hits = root.findAccessibilityNodeInfosByViewId(viewId)
      if (!hits.isNullOrEmpty()) return true
    }
    if (rule.contentDescriptions.isNotEmpty()) {
      return treeContainsDescription(root, rule.contentDescriptions, depth = 0)
    }
    return false
  }

  // Depth-first search for a matching contentDescription. Depth-capped:
  // pathological trees (webviews, long feeds) can be thousands of nodes,
  // and anything identifying a screen should be near the top anyway.
  private fun treeContainsDescription(
    node: AccessibilityNodeInfo,
    needles: List<String>,
    depth: Int,
  ): Boolean {
    if (depth > MAX_SEARCH_DEPTH) return false
    val description = node.contentDescription?.toString()
    if (description != null && needles.any { description.contains(it, ignoreCase = true) }) {
      return true
    }
    for (i in 0 until node.childCount) {
      val child = node.getChild(i) ?: continue
      if (treeContainsDescription(child, needles, depth + 1)) return true
    }
    return false
  }

  private companion object {
    const val TAG = "FallowBlocker"
    const val MAX_SEARCH_DEPTH = 25
    const val WEBSITE_BACK_COOLDOWN_MS = 1000L

    // Browsers we can watch: package name → the view ID of its URL bar.
    // To support another browser, find its URL bar's ID with the technique
    // in the README ("Finding view IDs") and add it here.
    val BROWSER_URL_BARS = mapOf(
      "com.android.chrome" to "com.android.chrome:id/url_bar",
      "com.chrome.beta" to "com.chrome.beta:id/url_bar",
      "com.brave.browser" to "com.brave.browser:id/url_bar",
      "org.mozilla.firefox" to "org.mozilla.firefox:id/mozac_browser_toolbar_url_view",
      "com.sec.android.app.sbrowser" to "com.sec.android.app.sbrowser:id/location_bar_edit_text",
    )
  }
}
