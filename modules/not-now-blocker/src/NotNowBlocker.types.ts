/**
 * A single rule describing a screen (not a whole app) to block.
 *
 * The shape is deliberately split by platform:
 * - `android` rules are enforced by the AccessibilityService, which can see
 *   individual view IDs / content descriptions inside another app.
 * - iOS has no equivalent of an AccessibilityService. The eventual iOS
 *   implementation (FamilyControls + ManagedSettings + DeviceActivity) can
 *   only shield whole apps, categories, or web domains — not screens within
 *   an app — so its rule shape will necessarily be different. It gets its
 *   own optional key rather than pretending the Android shape carries over.
 */
export type AndroidBlockRule = {
  /** The app's package name, e.g. "com.instagram.android". */
  packageName: string;
  /**
   * Fully-qualified view IDs that identify the blocked screen, e.g.
   * "com.instagram.android:id/clips_viewer_view_pager".
   * Matched exactly. Find these with Layout Inspector — see README.
   */
  viewIds?: string[];
  /**
   * Content descriptions to match. Matched as case-insensitive substrings
   * against every node in the window, so keep these specific.
   */
  contentDescriptions?: string[];
};

export type BlockRule = {
  /** Human-readable name, only used for your own sanity. */
  label: string;
  android?: AndroidBlockRule;
  // ios?: IosBlockRule;  // future: FamilyControls app/category tokens
};

/** A launchable app installed on the device, as shown in the picker. */
export type InstalledApp = {
  /** Display name, e.g. "Instagram". */
  label: string;
  /** e.g. "com.instagram.android". */
  packageName: string;
};
