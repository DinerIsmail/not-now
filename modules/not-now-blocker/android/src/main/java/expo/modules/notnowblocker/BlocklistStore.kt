package expo.modules.notnowblocker

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import org.json.JSONArray

/**
 * One Android-side block rule, parsed from the JSON pushed over by JS.
 * The source of truth is config/blocklist.ts in the app; this is just its
 * Android projection (entries without an `android` key are dropped here).
 */
data class BlockRule(
  /** Human-readable name, shown on the shield over a blocked screen. */
  val label: String,
  val packageName: String,
  val viewIds: List<String>,
  val contentDescriptions: List<String>,
)

/**
 * One window of time during which blocking is enforced, parsed from the
 * JSON pushed over by JS. Mirrors `ScheduleWindow` in
 * src/NotNowBlocker.types.ts.
 *
 * The schedule is global — it gates every kind of block, not one list.
 * An empty schedule means "always blocking".
 */
data class ScheduleWindow(
  /** Days the window *starts* on. 0 = Sunday … 6 = Saturday, as in JS. */
  val days: Set<Int>,
  /** Minutes from local midnight, inclusive. */
  val startMinute: Int,
  /** Minutes from local midnight, exclusive; <= start means it wraps midnight. */
  val endMinute: Int,
) {
  /**
   * Whether the given local day-of-week and minute-of-day fall inside this
   * window. Kept identical to `covers` in modules/not-now-blocker/index.ts:
   * the service has no JS runtime, so the rule is expressed in both places
   * and the two must agree.
   */
  fun covers(day: Int, minute: Int): Boolean {
    if (endMinute > startMinute) {
      return days.contains(day) && minute >= startMinute && minute < endMinute
    }
    // Wraps past midnight: we're either in the tail of a window that
    // started today, or the head of one that started yesterday.
    val yesterday = (day + 6) % 7
    return (days.contains(day) && minute >= startMinute) ||
      (days.contains(yesterday) && minute < endMinute)
  }
}

/**
 * SharedPreferences-backed handoff between the JS runtime (which owns the
 * blocklist) and the AccessibilityService (which enforces it and has no JS
 * runtime attached).
 */
object BlocklistStore {
  const val PREFS_NAME = "not_now_blocker"
  const val KEY_RULES = "blocklist_json"
  const val KEY_BLOCKED_APPS = "blocked_apps_json"
  const val KEY_BLOCKED_WEBSITES = "blocked_websites_json"
  const val KEY_SCHEDULE = "schedule_json"
  private const val TAG = "NotNowBlocker"
  private const val MINUTES_PER_DAY = 24 * 60

  fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun save(context: Context, rulesJson: String) {
    prefs(context).edit().putString(KEY_RULES, rulesJson).apply()
  }

  // Whole-app blocks are just a set of package names, kept separate from
  // the screen rules: they come from the in-app picker, not from
  // config/blocklist.ts, and the service reacts to them differently
  // (Home instead of Back).
  fun saveBlockedApps(context: Context, packageNames: List<String>) =
    saveStringList(context, KEY_BLOCKED_APPS, packageNames)

  fun loadBlockedApps(context: Context): Set<String> =
    loadStringList(context, KEY_BLOCKED_APPS)

  // Blocked websites are bare domains ("youtube.com"), normalized on the
  // JS side before saving. Matched against the browser's URL bar by the
  // service (exact host or any subdomain).
  fun saveBlockedWebsites(context: Context, domains: List<String>) =
    saveStringList(context, KEY_BLOCKED_WEBSITES, domains)

  fun loadBlockedWebsites(context: Context): Set<String> =
    loadStringList(context, KEY_BLOCKED_WEBSITES)

  // The schedule is stored as the raw JSON string JS sent, so the app can
  // read it straight back out for its editor without a round-trip through
  // the parsed Kotlin shape (which drops nothing today, but would silently
  // lose any field added on the JS side first).
  fun saveSchedule(context: Context, windowsJson: String) {
    prefs(context).edit().putString(KEY_SCHEDULE, windowsJson).apply()
  }

  fun loadScheduleJson(context: Context): String =
    prefs(context).getString(KEY_SCHEDULE, null) ?: "[]"

  fun loadSchedule(context: Context): List<ScheduleWindow> {
    val json = prefs(context).getString(KEY_SCHEDULE, null) ?: return emptyList()
    return try {
      parseSchedule(json)
    } catch (e: Exception) {
      // A malformed schedule must fail *open* — i.e. back to always-on
      // blocking — rather than silently disabling the app's whole point.
      Log.w(TAG, "Failed to parse schedule JSON, blocking around the clock", e)
      emptyList()
    }
  }

  // Expects the ScheduleWindow[] shape from src/NotNowBlocker.types.ts.
  private fun parseSchedule(json: String): List<ScheduleWindow> {
    val windows = mutableListOf<ScheduleWindow>()
    val array = JSONArray(json)
    for (i in 0 until array.length()) {
      val entry = array.optJSONObject(i) ?: continue
      val days = entry.optJSONArray("days") ?: continue
      val parsedDays = (0 until days.length())
        .map { days.optInt(it, -1) }
        .filter { it in 0..6 }
        .toSet()
      // A window with no valid days can never match; dropping it here keeps
      // the "empty schedule means always on" check honest.
      if (parsedDays.isEmpty()) continue
      windows.add(
        ScheduleWindow(
          days = parsedDays,
          startMinute = entry.optInt("startMinute", 0).coerceIn(0, MINUTES_PER_DAY - 1),
          endMinute = entry.optInt("endMinute", 0).coerceIn(0, MINUTES_PER_DAY - 1),
        )
      )
    }
    return windows
  }

  private fun saveStringList(context: Context, key: String, values: List<String>) {
    prefs(context).edit().putString(key, JSONArray(values).toString()).apply()
  }

  private fun loadStringList(context: Context, key: String): Set<String> {
    val json = prefs(context).getString(key, null) ?: return emptySet()
    return try {
      val array = JSONArray(json)
      (0 until array.length())
        .mapNotNull { array.optString(it).takeIf { s -> s.isNotEmpty() } }
        .toSet()
    } catch (e: Exception) {
      Log.w(TAG, "Failed to parse $key JSON, blocking nothing", e)
      emptySet()
    }
  }

  fun load(context: Context): List<BlockRule> {
    val json = prefs(context).getString(KEY_RULES, null) ?: return emptyList()
    return try {
      parse(json)
    } catch (e: Exception) {
      // A malformed blocklist should never take the service down.
      Log.w(TAG, "Failed to parse blocklist JSON, blocking nothing", e)
      emptyList()
    }
  }

  // Expects the BlockRule[] shape defined in src/NotNowBlocker.types.ts.
  private fun parse(json: String): List<BlockRule> {
    val rules = mutableListOf<BlockRule>()
    val array = JSONArray(json)
    for (i in 0 until array.length()) {
      val entry = array.getJSONObject(i)
      val android = entry.optJSONObject("android") ?: continue
      val packageName = android.optString("packageName")
      if (packageName.isEmpty()) continue
      rules.add(
        BlockRule(
          label = entry.optString("label").ifEmpty { packageName },
          packageName = packageName,
          viewIds = android.optJSONArray("viewIds").toStringList(),
          contentDescriptions = android.optJSONArray("contentDescriptions").toStringList(),
        )
      )
    }
    return rules
  }

  private fun JSONArray?.toStringList(): List<String> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { optString(it).takeIf { s -> s.isNotEmpty() } }
  }
}
