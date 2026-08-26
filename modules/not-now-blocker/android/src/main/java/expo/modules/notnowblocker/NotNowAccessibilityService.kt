package expo.modules.notnowblocker

import android.accessibilityservice.AccessibilityService
import android.content.SharedPreferences
import android.graphics.Rect
import android.os.SystemClock
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * The enforcement half of the module. Entirely Android-specific: iOS offers
 * no way to observe or act on another app's UI. Its declaration lives in
 * this module's AndroidManifest.xml; its behaviour (which events we get,
 * whether view IDs are reported) is configured in
 * res/xml/not_now_accessibility_service.xml.
 *
 * Flow: window changes anywhere on the device → onAccessibilityEvent →
 * package name matches a rule? → does the window contain one of the rule's
 * view IDs / content descriptions? → global Back.
 */
class NotNowAccessibilityService : AccessibilityService() {

  private var rules: List<BlockRule> = emptyList()
  private var blockedApps: Set<String> = emptySet()
  private var blockedWebsites: Set<String> = emptySet()

  // Last time we pressed Back for a blocked website. Content-changed events
  // arrive in bursts while a page loads; without a cooldown one blocked
  // page would trigger a volley of Back presses that then eats the pages
  // *behind* it too.
  private var lastWebsiteBackAt = 0L

  // Screen rules are edge-triggered, and this is load-bearing. A blocked
  // screen's view IDs stay in the window tree for as long as that screen is
  // up, so matching on mere presence re-fired on every subsequent event in
  // the same app: opening Instagram's comments or share sheet raises a
  // window-state change, the Reels pager is still sitting behind the sheet,
  // it matches again, and Back closes the sheet the user just opened.
  // Remembering what we already acted on turns "is a blocked screen
  // present?" into "did the user just arrive at one?".
  private var matchedScreen: String? = null
  private var lastScreenEvalAt = 0L
  private var lastScreenBackAt = 0L

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
        handleScreenRules(packageName, throttled = false)
      }
      // Content changed inside the current window. Navigating within a
      // browser never changes windows, so this is the only signal that the
      // URL changed. Fires very frequently, so both handlers below bail
      // cheaply: the website one on the browser lookup, the screen one on
      // "this package has no rules" before it ever touches the window tree.
      AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
        if (BROWSER_URL_BARS.containsKey(packageName)) {
          handleBlockedWebsite(packageName)
        }
        // Screen rules need this event too. Swiping into a Reels-style pager
        // changes no window, so a state-change-only handler never sees the
        // user arrive — it only woke up later, when a sheet or dialog raised
        // a window-state change, which is precisely how it ended up closing
        // those instead of blocking the reel.
        handleScreenRules(packageName, throttled = true)
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

  private fun handleScreenRules(packageName: String, throttled: Boolean) {
    val matching = rules.filter { it.packageName == packageName }
    if (matching.isEmpty()) {
      // No rules here, so the user has left any blocked screen behind:
      // clear the latch so coming back to one counts as a fresh arrival.
      matchedScreen = null
      return
    }

    // Content-changed events arrive in bursts. Evaluating every one would
    // walk the window tree far more often than the UI actually changes.
    val now = SystemClock.uptimeMillis()
    if (throttled && now - lastScreenEvalAt < SCREEN_EVAL_THROTTLE_MS) return
    lastScreenEvalAt = now

    // rootInActiveWindow is the full window tree; event.source is often null
    // or just the changed subtree, so the root is the reliable place to look.
    val root = rootInActiveWindow ?: return

    val matchedOn = matching.asSequence()
      .mapNotNull { windowMatches(root, it) }
      .firstOrNull()

    if (matchedOn == null) {
      matchedScreen = null
      return
    }

    // Already acted on this arrival. The blocked view stays in the tree the
    // whole time the screen is up, so without this every later event —
    // including the one that opens a comments sheet — would fire Back again.
    val key = "$packageName|$matchedOn"
    if (key == matchedScreen) return
    if (now - lastScreenBackAt < SCREEN_BACK_COOLDOWN_MS) return

    matchedScreen = key
    lastScreenBackAt = now
    Log.i(TAG, "Blocked screen in $packageName (matched $matchedOn), performing Back")
    performGlobalAction(GLOBAL_ACTION_BACK)
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

  /**
   * Whether this node is actually in front of the user, rather than merely
   * present in the window tree.
   *
   * This distinction is the whole ballgame for screen rules. Instagram keeps
   * the Reels pager inflated inside MainTabActivity, so
   * `clips_viewer_view_pager` resolves from the instant the app opens — on
   * the feed, on a story, anywhere. Matching on existence alone therefore
   * fired Back within half a second of launch, and because a freshly-opened
   * app sits at its task root, Back exited Instagram entirely instead of
   * backing out of a reel.
   *
   * A view parked in an unselected tab reports isVisibleToUser = false and
   * usually collapses to empty bounds, so both checks together keep a rule
   * scoped to the screen the user is really on.
   */
  private fun AccessibilityNodeInfo.isOnScreen(): Boolean {
    if (!isVisibleToUser) return false
    val bounds = Rect()
    getBoundsInScreen(bounds)
    return bounds.width() > 0 && bounds.height() > 0
  }

  override fun onInterrupt() {
    // Called when the system wants feedback interrupted (e.g. speech).
    // We produce no ongoing feedback, so there is nothing to stop.
  }

  // Returns the view ID / description that matched, or null for no match.
  // The specific token (rather than a bare Boolean) is what keys the
  // edge-trigger latch in handleScreenRules, and it makes the log line say
  // which half of a multi-part rule actually fired.
  private fun windowMatches(root: AccessibilityNodeInfo, rule: BlockRule): String? {
    // View IDs first: the framework indexes these, so lookup is cheap and
    // doesn't require walking the tree ourselves.
    for (viewId in rule.viewIds) {
      val hits = root.findAccessibilityNodeInfosByViewId(viewId)
      if (hits != null && hits.any { it.isOnScreen() }) return viewId
    }
    if (rule.contentDescriptions.isNotEmpty()) {
      return findDescription(root, rule.contentDescriptions, depth = 0)
    }
    return null
  }

  // Depth-first search for a matching contentDescription, returning the
  // needle that matched (not the node's full description, so the result is
  // stable enough to use as a latch key). Depth-capped: pathological trees
  // (webviews, long feeds) can be thousands of nodes, and anything
  // identifying a screen should be near the top anyway.
  private fun findDescription(
    node: AccessibilityNodeInfo,
    needles: List<String>,
    depth: Int,
  ): String? {
    if (depth > MAX_SEARCH_DEPTH) return null
    val description = node.contentDescription?.toString()
    if (description != null && node.isOnScreen()) {
      val hit = needles.firstOrNull { description.contains(it, ignoreCase = true) }
      if (hit != null) return hit
    }
    for (i in 0 until node.childCount) {
      val child = node.getChild(i) ?: continue
      findDescription(child, needles, depth + 1)?.let { return it }
    }
    return null
  }

  private companion object {
    const val TAG = "NotNowBlocker"
    const val MAX_SEARCH_DEPTH = 25
    const val WEBSITE_BACK_COOLDOWN_MS = 1000L

    // Screen rules: how often content-changed events may trigger a tree
    // walk, and a floor between Back presses as a backstop to the latch.
    const val SCREEN_EVAL_THROTTLE_MS = 250L
    const val SCREEN_BACK_COOLDOWN_MS = 1000L

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
