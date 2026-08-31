package expo.modules.notnowblocker

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Rect
import android.os.SystemClock
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.Calendar

/**
 * The enforcement half of the module. Entirely Android-specific: iOS offers
 * no way to observe or act on another app's UI. Its declaration lives in
 * this module's AndroidManifest.xml; its behaviour (which events we get,
 * whether view IDs are reported) is configured in
 * res/xml/not_now_accessibility_service.xml.
 *
 * Flow: something changes on screen → onAccessibilityEvent → is the schedule
 * in a blocking window? → is the foreground content blocked? → put a shield
 * (BlockOverlay) over it, or take one down.
 *
 * The service *shields* rather than *ejects*. It used to fire Back or Home
 * the instant it saw something blocked, which was both jarring and, in a
 * browser, wrong: Back on a blocked page in a fresh tab has nowhere to go,
 * so it closed the browser. Covering the content leaves the user where they
 * are and makes leaving their decision — the shield carries the button that
 * does it.
 *
 * That change also deleted a whole class of bug. Ejecting was destructive
 * and could not be repeated, so it needed an edge-trigger latch and two
 * cooldowns to avoid re-firing on every event while a blocked screen stayed
 * in the tree — the mechanism that used to close the comments sheet a user
 * had just opened over a blocked reel. Showing a shield is idempotent:
 * re-showing the same one is a no-op, so the service can simply answer "is
 * this blocked right now?" on every event and keep the overlay in step.
 */
class NotNowAccessibilityService : AccessibilityService() {

  private var rules: List<BlockRule> = emptyList()
  private var blockedApps: Set<String> = emptySet()
  private var blockedWebsites: Set<String> = emptySet()

  // Windows during which blocking is enforced. Empty means "always",
  // which is both the default and what a corrupt stored schedule falls
  // back to — the service failing open is far less bad than it silently
  // switching itself off.
  private var schedule: List<ScheduleWindow> = emptyList()

  // Answering "are we in a blocking window?" costs a Calendar allocation,
  // and content-changed events arrive dozens per second in a browser. The
  // answer only changes on a minute boundary, so caching it for a second
  // is free accuracy-wise and removes the allocation from the hot path.
  private var scheduleActive = true
  private var scheduleCheckedAt = 0L

  // Built lazily: constructing it resolves WINDOW_SERVICE, which wants a
  // context that is actually ready, and a service that never blocks
  // anything never needs one.
  private val overlay by lazy { BlockOverlay(this) }

  /** Package the shield is currently covering, or null when it is down. */
  private var shieldedPackage: String? = null

  /**
   * When evaluations first started saying "nothing blocked here" while the
   * shield was up, or 0. See [applyBlock] — reading another app's UI is not
   * perfectly reliable, and one bad read must not flicker the shield.
   */
  private var clearSince = 0L

  private var lastEvalAt = 0L

  /**
   * Deadline until which no shield may go up, set when the user asks to
   * leave. This is not an optimisation, it is the fix for a genuinely bad
   * bug: leaving is not instant, and a browser's URL bar still reads the
   * blocked domain for a few hundred milliseconds after Back is pressed.
   * Without this the shield sprang straight back up mid-navigation, the
   * user pressed "Go back" a second time, and *that* press — arriving when
   * the tab had already rewound to a page with no history behind it — is
   * what closed the browser outright.
   */
  private var suppressShieldUntil = 0L

  // Package name → display name, for the shield's heading. Labels never
  // change while the service is alive, and PackageManager lookups are not
  // free, so they are worth keeping.
  private val labelCache = mutableMapOf<String, String>()

  /** Everything the shield needs to describe one piece of blocked content. */
  private data class Block(
    /** Identity, so re-showing the same shield is a no-op. */
    val key: String,
    val heading: String,
    val detail: String,
    val actionLabel: String,
    /** What the shield's button does — the eject that is now opt-in. */
    val globalAction: Int,
  )

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
      BlocklistStore.KEY_SCHEDULE -> {
        schedule = BlocklistStore.loadSchedule(this)
        // Drop the cached answer too, or an edit made seconds ago wouldn't
        // take effect until the cache expired.
        scheduleCheckedAt = 0L
        Log.i(TAG, "Schedule reloaded: ${schedule.size} window(s)")
      }
      else -> return@OnSharedPreferenceChangeListener
    }
    // Something the user just unblocked may be what the shield is covering.
    // Drop it; the next event puts it back if it is still blocked, and in
    // the meantime the user isn't staring at a shield they just removed.
    clearShield()
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    rules = BlocklistStore.load(this)
    blockedApps = BlocklistStore.loadBlockedApps(this)
    blockedWebsites = BlocklistStore.loadBlockedWebsites(this)
    schedule = BlocklistStore.loadSchedule(this)
    BlocklistStore.prefs(this).registerOnSharedPreferenceChangeListener(prefsListener)
    Log.i(
      TAG,
      "Service connected, ${rules.size} rule(s), ${blockedApps.size} blocked app(s), " +
        "${blockedWebsites.size} blocked website(s), " +
        if (schedule.isEmpty()) "no schedule (always on)" else "${schedule.size} schedule window(s)"
    )
  }

  override fun onUnbind(intent: Intent?): Boolean {
    // The service is going away; a shield left on screen would have nothing
    // left to take it down.
    clearShield()
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    clearShield()
    BlocklistStore.prefs(this).unregisterOnSharedPreferenceChangeListener(prefsListener)
    super.onDestroy()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent) {
    val packageName = event.packageName?.toString() ?: return

    // Belt-and-braces: never act on our own app, whatever the stored state
    // says — otherwise a bad blocklist could lock the user out of the very
    // screen they need to fix it. This also means the shield's own window
    // can never cause the service to re-evaluate itself.
    if (packageName == this.packageName) return

    // Outside the schedule the service is inert. Checked before anything
    // else so an out-of-hours event costs a clock read and nothing more —
    // no window-tree walks, no URL-bar lookups.
    if (!blockingActiveNow()) {
      clearShield()
      return
    }

    // The user is on their way out; let the navigation finish before
    // deciding anything. The shield is already down by this point.
    if (SystemClock.uptimeMillis() < suppressShieldUntil) return

    val windowChanged = when (event.eventType) {
      // The foreground window/activity changed: a real navigation.
      AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> true
      // Content changed inside the current window. Navigating within a
      // browser never changes windows, so this is the only signal that the
      // URL changed, and some in-app navigation (swiping into a Reels-style
      // pager) only shows up here too. It fires very frequently — hence the
      // throttle below, and the cheap early exits in each check.
      AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> false
      else -> return
    }

    if (!windowChanged) {
      val now = SystemClock.uptimeMillis()
      if (now - lastEvalAt < EVAL_THROTTLE_MS) return
      lastEvalAt = now
    }

    applyBlock(packageName, evaluate(packageName), immediate = windowChanged)
  }

  /**
   * What, if anything, is blocked about the foreground right now.
   *
   * Order matters only in that the cheapest checks come first. Each one
   * exits before touching the window tree when it has nothing to say —
   * a set lookup for apps, a browser-map lookup for websites, a rule filter
   * for screens — which is what keeps this affordable on the flood of
   * content-changed events.
   */
  private fun evaluate(packageName: String): Block? =
    blockedApp(packageName)
      ?: blockedWebsite(packageName)
      ?: blockedScreen(packageName)

  /**
   * Puts the shield up or takes it down to match [block].
   *
   * The asymmetry is deliberate. Shielding happens immediately: being late
   * is the one failure that matters. Un-shielding waits, because "I could
   * not find the URL bar in this frame" and "the user has left" look
   * identical from here, and a shield that flickers off and on over blocked
   * content is worse than one that lingers a moment. The wait is skipped
   * when the foreground app changed or a window-state event says the user
   * genuinely navigated, so leaving never feels sticky.
   */
  private fun applyBlock(packageName: String, block: Block?, immediate: Boolean) {
    if (block != null) {
      clearSince = 0L
      shieldedPackage = packageName
      val shown = overlay.show(block.key, block.heading, block.detail, block.actionLabel) {
        clearShield()
        suppressShieldUntil = SystemClock.uptimeMillis() + LEAVE_SUPPRESS_MS
        Log.i(TAG, "User left ${block.key}, holding off for ${LEAVE_SUPPRESS_MS}ms")
        performGlobalAction(block.globalAction)
      }
      if (!shown) {
        // The shield could not be put up. Rather than let blocked content
        // through, fall back to the old behaviour of ejecting the user.
        Log.w(TAG, "Shield unavailable for ${block.key}, falling back to eject")
        shieldedPackage = null
        performGlobalAction(block.globalAction)
      }
      return
    }

    if (!overlay.isShowing) return

    if (immediate || packageName != shieldedPackage) {
      clearShield()
      return
    }

    val now = SystemClock.uptimeMillis()
    if (clearSince == 0L) {
      clearSince = now
      return
    }
    if (now - clearSince < SHIELD_CLEAR_GRACE_MS) return
    clearShield()
  }

  private fun clearShield() {
    clearSince = 0L
    shieldedPackage = null
    // Cheap no-op when nothing is showing, which is the common case.
    overlay.hide()
  }

  /**
   * Whether the current local time falls inside a blocking window.
   *
   * An empty schedule means always — both because that's the sensible
   * default for a device that has never opened the schedule editor, and
   * because it's what the app did before schedules existed, so existing
   * installs behave identically until the user sets one.
   */
  private fun blockingActiveNow(): Boolean {
    if (schedule.isEmpty()) return true
    val now = SystemClock.uptimeMillis()
    // The 0 check is what makes invalidation (scheduleCheckedAt = 0) work
    // even in the first second of uptime, when the subtraction alone would
    // still look fresh.
    if (scheduleCheckedAt != 0L && now - scheduleCheckedAt < SCHEDULE_CACHE_MS) return scheduleActive
    scheduleCheckedAt = now

    // Calendar rather than a stored epoch offset: the schedule is a
    // wall-clock rule, so it has to follow the device's timezone and DST
    // changes, which only the calendar knows about.
    val calendar = Calendar.getInstance()
    // Calendar.SUNDAY is 1; JS Date#getDay makes Sunday 0. The stored days
    // use the JS convention, so shift into it here.
    val day = calendar.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY
    val minute = calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)

    val active = schedule.any { it.covers(day, minute) }
    if (active != scheduleActive) {
      Log.i(TAG, if (active) "Entered a blocking window" else "Left the blocking window")
    }
    scheduleActive = active
    return active
  }

  // Whole-app blocks need no window inspection: being in the foreground at
  // all is the whole rule. Home rather than Back is still the right escape
  // here — Back from inside an app just walks up its own screen stack, so
  // the user would meet the shield again on every step.
  private fun blockedApp(packageName: String): Block? {
    if (!blockedApps.contains(packageName)) return null
    return Block(
      key = "app:$packageName",
      heading = appLabel(packageName),
      detail = "This app is blocked.",
      actionLabel = "Go home",
      globalAction = GLOBAL_ACTION_HOME,
    )
  }

  // Reads the browser's URL bar and shields if its host matches a blocked
  // domain (exact or subdomain). Back rather than Home for the escape: in a
  // browser, Back is page-level, so it returns to the previous page.
  private fun blockedWebsite(packageName: String): Block? {
    if (blockedWebsites.isEmpty()) return null
    val urlBarId = BROWSER_URL_BARS[packageName] ?: return null
    val root = rootInActiveWindow ?: return null
    val urlBar = root.findAccessibilityNodeInfosByViewId(urlBarId)?.firstOrNull() ?: return null

    // A focused URL bar means the user is typing in it; the text is a
    // half-finished query, not a visited page. Acting on it would fight
    // the keyboard.
    if (urlBar.isFocused) return null

    val host = hostOf(urlBar.text?.toString() ?: return null) ?: return null
    if (blockedWebsites.none { host == it || host.endsWith(".$it") }) return null

    return Block(
      key = "web:$host",
      heading = host,
      detail = "This site is blocked.",
      actionLabel = "Go back",
      globalAction = GLOBAL_ACTION_BACK,
    )
  }

  private fun blockedScreen(packageName: String): Block? {
    val matching = rules.filter { it.packageName == packageName }
    if (matching.isEmpty()) return null

    // rootInActiveWindow is the full window tree; event.source is often null
    // or just the changed subtree, so the root is the reliable place to look.
    val root = rootInActiveWindow ?: return null

    val (rule, matchedOn) = matching.asSequence()
      .mapNotNull { rule -> windowMatches(root, rule)?.let { rule to it } }
      .firstOrNull() ?: return null

    return Block(
      // The matched token is part of the key so that moving between two
      // blocked screens in the same app rebuilds the shield rather than
      // leaving the first one's heading up.
      key = "screen:$packageName|$matchedOn",
      heading = rule.label,
      detail = "This screen is blocked.",
      actionLabel = "Go back",
      globalAction = GLOBAL_ACTION_BACK,
    )
  }

  private fun appLabel(packageName: String): String = labelCache.getOrPut(packageName) {
    try {
      packageManager.getApplicationLabel(
        packageManager.getApplicationInfo(packageName, 0)
      ).toString()
    } catch (e: Exception) {
      // Visibility of other packages comes from the <queries> declaration in
      // this module's manifest; anything outside it falls back to the raw
      // package name, which is still recognisable enough on a shield.
      Log.w(TAG, "No label for $packageName", e)
      packageName
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

  /**
   * Whether this node is actually in front of the user, rather than merely
   * present in the window tree.
   *
   * This distinction is the whole ballgame for screen rules. Instagram keeps
   * the Reels pager inflated inside MainTabActivity, so
   * `clips_viewer_view_pager` resolves from the instant the app opens — on
   * the feed, on a story, anywhere. Matching on existence alone therefore
   * shielded the whole app within half a second of launch.
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
    // We produce no ongoing feedback, so there is nothing to stop. The
    // shield is not "feedback" — tearing it down here would hand the user a
    // way to dismiss it by triggering any talkback-style interruption.
  }

  // Returns the view ID / description that matched, or null for no match.
  // The specific token (rather than a bare Boolean) keys the shield, and it
  // makes the log line say which half of a multi-part rule actually fired.
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
  // stable enough to use as a shield key). Depth-capped: pathological trees
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

    // How often content-changed events may trigger a full evaluation. They
    // arrive in bursts; the UI does not actually change that fast.
    const val EVAL_THROTTLE_MS = 250L

    // How long evaluations must agree that nothing is blocked before the
    // shield comes down, when the user has not visibly navigated away.
    const val SHIELD_CLEAR_GRACE_MS = 600L

    // How long after the user asks to leave before a shield may go up
    // again. Long enough to cover a browser's back-navigation and the URL
    // bar catching up with it; short enough that walking straight into
    // another blocked page is still caught.
    const val LEAVE_SUPPRESS_MS = 1500L

    // How long a schedule decision is reused before the clock is read
    // again. Well under the minute at which the answer can actually
    // change, so this bounds staleness at one second either side of a
    // window's edge.
    const val SCHEDULE_CACHE_MS = 1000L

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
