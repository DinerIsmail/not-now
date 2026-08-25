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
  val packageName: String,
  val viewIds: List<String>,
  val contentDescriptions: List<String>,
)

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
  private const val TAG = "NotNowBlocker"

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
