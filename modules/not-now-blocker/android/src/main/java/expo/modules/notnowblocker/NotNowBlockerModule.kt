package expo.modules.notnowblocker

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.net.Uri
import android.provider.Settings
import android.util.Log
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

/**
 * The JS-facing Expo module. Everything in this file is Android-specific;
 * the iOS counterpart lives in ios/NotNowBlockerModule.swift and must expose
 * the same three functions (see modules/not-now-blocker/index.ts).
 */
class NotNowBlockerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("NotNowBlocker")

    // True iff our AccessibilityService is listed in the system's
    // enabled-services setting. There is no API to enable it
    // programmatically — the user must flip the toggle themselves,
    // which is why openAccessibilitySettings exists.
    Function("isAccessibilityServiceEnabled") {
      val expected = ComponentName(context, NotNowAccessibilityService::class.java)
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
        // Never list ourselves: blocking Not Now with Not Now would lock the
        // user out of their own escape hatch.
        .filter { it.packageName != context.packageName }
        .map { info ->
          buildMap {
            put("label", info.loadLabel(pm).toString())
            put("packageName", info.packageName)
            // Omitted rather than null when extraction fails, so the JS type
            // stays `icon?: string` and the picker falls back to an initial.
            iconUri(pm, info)?.let { put("icon", it) }
          }
        }
        .sortedBy { (it["label"] as String).lowercase() }
    }
  }

  /**
   * Extracts an app's launcher icon to a PNG in the cache dir and returns a
   * `file://` URI for it.
   *
   * Files rather than base64 data URIs on purpose: the picker lists a couple
   * of hundred apps, and inlining icons would push megabytes across the
   * bridge on every call whether or not a row is ever scrolled into view.
   * With file URIs, React Native decodes only what FlatList actually renders.
   *
   * Cached by package name and reused, so this cost is paid once. An app that
   * changes its icon in an update will keep showing the old one until the OS
   * clears the cache dir — an acceptable trade for not stat-ing every package
   * on every call.
   */
  private fun iconUri(pm: PackageManager, info: ApplicationInfo): String? {
    return try {
      val dir = File(context.cacheDir, ICON_DIR_NAME).apply { mkdirs() }
      val file = File(dir, "${info.packageName}.png")
      if (!file.exists() || file.length() == 0L) {
        val bitmap = pm.getApplicationIcon(info).toSquareBitmap(ICON_SIZE_PX)
        FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
      }
      Uri.fromFile(file).toString()
    } catch (e: Exception) {
      // A single unreadable icon must not fail the whole listing.
      Log.w(TAG, "Could not extract icon for ${info.packageName}", e)
      null
    }
  }

  // Drawn via Canvas rather than cast to BitmapDrawable: launcher icons are
  // just as often AdaptiveIconDrawable or a vector, and every Drawable can
  // render itself into a canvas.
  private fun Drawable.toSquareBitmap(size: Int): Bitmap {
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    setBounds(0, 0, size, size)
    draw(Canvas(bitmap))
    return bitmap
  }

  private companion object {
    const val TAG = "NotNowBlocker"
    const val ICON_DIR_NAME = "app-icons"
    // Comfortably above the 40dp the picker renders at, even on a 3x screen.
    const val ICON_SIZE_PX = 144
  }
}
