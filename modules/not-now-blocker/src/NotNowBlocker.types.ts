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
  /**
   * `file://` URI of the app's launcher icon, extracted to the cache dir by
   * the native module. Optional: absent when icon extraction failed, and
   * always absent on iOS/web, where apps can't be enumerated at all.
   */
  icon?: string;
};

/**
 * One window of time during which blocking is enforced.
 *
 * The schedule is global: it gates *all* three kinds of block (screen
 * rules, whole apps, websites) rather than being attached to any one of
 * them. An empty schedule means "always on", which is what the app did
 * before schedules existed.
 *
 * Deliberately stored as plain numbers rather than Date/ISO strings: a
 * schedule is a recurring wall-clock rule, not an instant. Dates would
 * carry a timezone and a calendar day that are meaningless here and would
 * drift across DST.
 */
export type ScheduleWindow = {
  /** Stable key for list rendering and removal. */
  id: string;
  /**
   * Days the window starts on, as JS `Date#getDay` numbers:
   * 0 = Sunday … 6 = Saturday. A window that wraps past midnight is
   * anchored to its *start* day, so `days: [5]` with 22:00–02:00 means
   * Friday night into Saturday morning.
   */
  days: number[];
  /** Start, in minutes from local midnight (0–1439). 9am = 540. */
  startMinute: number;
  /**
   * End, in minutes from local midnight (0–1439), exclusive. When this is
   * less than or equal to `startMinute` the window wraps past midnight
   * into the following day.
   */
  endMinute: number;
};
