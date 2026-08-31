package expo.modules.notnowblocker

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The full-screen shield shown over blocked content.
 *
 * This replaces the old "press Back / Home the moment we see something
 * blocked" behaviour, which had a nasty failure mode: Back on a blocked page
 * in a fresh browser tab has nowhere to go, so it closed the browser
 * outright. Covering the content instead leaves the user where they are and
 * makes leaving *their* decision — the same model as an iOS Screen Time
 * shield.
 *
 * The window type is the load-bearing detail. `TYPE_ACCESSIBILITY_OVERLAY`
 * is the one overlay type an AccessibilityService may post on the strength
 * of BIND_ACCESSIBILITY_SERVICE alone — no SYSTEM_ALERT_WINDOW, so no
 * "display over other apps" toggle for the user to find and grant.
 *
 * Views are built in code rather than inflated from XML: the service has no
 * app theme attached, so an inflated layout would resolve theme attributes
 * against nothing and render unpredictably.
 */
class BlockOverlay(private val service: AccessibilityService) {

  private val windowManager =
    service.getSystemService(Context.WINDOW_SERVICE) as WindowManager

  private var view: View? = null

  /**
   * Identity of what is currently shielded. Re-showing the same key is a
   * no-op, which matters because content-changed events arrive in bursts:
   * without it, one blocked page would tear the overlay down and rebuild it
   * several times a second.
   */
  private var shownKey: String? = null

  val isShowing: Boolean
    get() = view != null

  /**
   * Puts the shield up, or leaves it alone if it is already showing `key`.
   * Returns false if the window could not be added, which the caller uses
   * to fall back to the old eject-the-user behaviour — a shield that fails
   * to appear must not silently mean "not blocked".
   */
  fun show(
    key: String,
    heading: String,
    detail: String,
    actionLabel: String,
    onAction: () -> Unit,
  ): Boolean {
    if (shownKey == key && view != null) return true
    hide()
    val content = buildView(heading, detail, actionLabel, onAction)
    return try {
      windowManager.addView(content, layoutParams())
      view = content
      shownKey = key
      Log.i(TAG, "Shield shown: $key")
      true
    } catch (e: Exception) {
      // Adding a window can fail (odd OEM policies, a display going away
      // mid-add). Never let that take the service down.
      Log.w(TAG, "Could not add the block overlay", e)
      false
    }
  }

  fun hide() {
    val current = view ?: return
    // Cleared before the removeView call, so a throwing remove still leaves
    // this object's state consistent rather than stuck believing a
    // half-removed view is up.
    view = null
    shownKey = null
    try {
      windowManager.removeView(current)
      Log.i(TAG, "Shield hidden")
    } catch (e: Exception) {
      Log.w(TAG, "Could not remove the block overlay", e)
    }
  }

  private fun layoutParams() = WindowManager.LayoutParams(
    WindowManager.LayoutParams.MATCH_PARENT,
    WindowManager.LayoutParams.MATCH_PARENT,
    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
    // NOT_FOCUSABLE, deliberately, and it does two jobs. It keeps the
    // overlay out of the accessibility framework's idea of the "active
    // window", so rootInActiveWindow still returns the app underneath and
    // the service can keep evaluating whether the shield is still needed.
    // And it leaves the hardware/gesture Back key with that app, so the
    // user is never trapped behind the shield. Touch still lands here —
    // that would be FLAG_NOT_TOUCHABLE, which is pointedly not set, so the
    // shielded UI cannot be tapped through the overlay.
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
    PixelFormat.TRANSLUCENT,
  ).apply {
    // Keep the shield out of the system bars. An accessibility overlay is
    // layered above the navigation bar, so a MATCH_PARENT one can cover it
    // — and a shield that swallows the Home button leaves its own button as
    // the user's only way out. Insetting the window means the system bars
    // stay visible and usable no matter what happens to this overlay, which
    // is the difference between a shield and a trap.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      fitInsetsTypes = WindowInsets.Type.systemBars()
    }
  }

  private fun buildView(
    heading: String,
    detail: String,
    actionLabel: String,
    onAction: () -> Unit,
  ): View {
    val root = LinearLayout(service).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(BACKGROUND)
      setPadding(dp(32), dp(32), dp(32), dp(32))
      // Belt and braces against tap-through; the window already consumes
      // touches across its whole area.
      isClickable = true
    }

    root.addView(
      TextView(service).apply {
        text = "Not Now"
        setTextColor(MUTED)
        letterSpacing = 0.15f
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      }
    )

    root.addView(
      TextView(service).apply {
        text = heading
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
        gravity = Gravity.CENTER
        layoutParams = spacedParams(top = dp(12))
      }
    )

    root.addView(
      TextView(service).apply {
        text = detail
        setTextColor(MUTED)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        gravity = Gravity.CENTER
        layoutParams = spacedParams(top = dp(8))
      }
    )

    root.addView(
      Button(service).apply {
        text = actionLabel
        setTextColor(BACKGROUND)
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        setPadding(dp(24), dp(12), dp(24), dp(12))
        background = GradientDrawable().apply {
          setColor(Color.WHITE)
          cornerRadius = dp(8).toFloat()
        }
        setOnClickListener { button ->
          // One shot. The shield is about to come down anyway, and a second
          // press would send a second Back — which in a browser is the
          // difference between "back to the previous page" and "tab closed,
          // browser gone".
          button.isEnabled = false
          onAction()
        }
        layoutParams = spacedParams(top = dp(32))
      }
    )

    return root
  }

  private fun spacedParams(top: Int) = LinearLayout.LayoutParams(
    LinearLayout.LayoutParams.WRAP_CONTENT,
    LinearLayout.LayoutParams.WRAP_CONTENT,
  ).apply { topMargin = top }

  private fun dp(value: Int): Int = TypedValue.applyDimension(
    TypedValue.COMPLEX_UNIT_DIP,
    value.toFloat(),
    service.resources.displayMetrics,
  ).toInt()

  private companion object {
    const val TAG = "NotNowBlocker"
    // Opaque, not translucent: a shield you can read the blocked content
    // through is not much of a shield.
    const val BACKGROUND = 0xFF1A1A1A.toInt()
    const val MUTED = 0xFF9A9A9A.toInt()
  }
}
