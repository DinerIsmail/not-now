package expo.modules.fallowblocker

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JS-facing Expo module. Everything in this file is Android-specific;
 * the iOS counterpart lives in ios/FallowBlockerModule.swift and must expose
 * the same three functions (see modules/fallow-blocker/index.ts).
 */
class FallowBlockerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("FallowBlocker")

    // True iff our AccessibilityService is listed in the system's
    // enabled-services setting. There is no API to enable it
    // programmatically — the user must flip the toggle themselves,
    // which is why openAccessibilitySettings exists.
    Function("isAccessibilityServiceEnabled") {
      val expected = ComponentName(context, FallowAccessibilityService::class.java)
      val enabled = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
      ) ?: return@Function false
      // The setting is a colon-separated list of flattened component names,
      // possibly in shorthand form ("pkg/.Cls"), so parse rather than
      // string-compare.
      enabled.split(':')
        .mapNotNull { ComponentName.unflattenFromString(it) }
        .any { it == expected }
    }

    Function("openAccessibilitySettings") {
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
        // Started from an application context, so a new task is required.
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
    }

    // Persists the blocklist (already JSON-encoded by the JS wrapper) where
    // the AccessibilityService can read it. The service runs in this same
    // process but with no JS runtime attached, so SharedPreferences is the
    // handoff point.
    Function("setBlocklist") { rulesJson: String ->
      BlocklistStore.save(context, rulesJson)
    }

    // Apps the user picked in the UI to block entirely. Same
    // SharedPreferences handoff as the screen rules, separate key.
    Function("setBlockedApps") { packageNames: List<String> ->
      BlocklistStore.saveBlockedApps(context, packageNames)
    }

    Function("getBlockedApps") {
      BlocklistStore.loadBlockedApps(context).toList()
    }

    // Domains the user chose to block in browsers, e.g. "youtube.com".
    Function("setBlockedWebsites") { domains: List<String> ->
      BlocklistStore.saveBlockedWebsites(context, domains)
    }

    Function("getBlockedWebsites") {
      BlocklistStore.loadBlockedWebsites(context).toList()
    }

    // Lists launchable apps — the ones with a launcher icon — which is what
    // a user thinks of as "installed apps". Visibility of other packages is
    // granted by the <queries> declaration in this module's manifest
    // (Android 11+ package visibility filtering would otherwise return
    // only a handful of system packages).
    // Async because loading labels for ~100 apps takes long enough to
    // notice on the JS thread.
    AsyncFunction("getInstalledApps") {
      val pm = context.packageManager
      val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      @Suppress("DEPRECATION") // ResolveInfoFlags overload requires API 33
      pm.queryIntentActivities(launcherIntent, PackageManager.MATCH_ALL)
        .map { it.activityInfo.applicationInfo }
        .distinctBy { it.packageName }
        // Never list ourselves: blocking Fallow with Fallow would lock the
        // user out of their own escape hatch.
        .filter { it.packageName != context.packageName }
        .map {
          mapOf(
            "label" to it.loadLabel(pm).toString(),
            "packageName" to it.packageName,
          )
        }
        .sortedBy { (it["label"] as String).lowercase() }
    }
  }
}
