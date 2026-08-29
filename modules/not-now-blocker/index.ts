/**
 * Public, platform-neutral API of the not-now-blocker module.
 * App code should import from here and nowhere deeper.
 *
 * Android: implemented by NotNowBlockerModule.kt + NotNowAccessibilityService.kt.
 * iOS: currently a stub (see ios/NotNowBlockerModule.swift). A future
 *      FamilyControls implementation slots in behind these same functions.
 */
import NotNowBlockerModule from './src/NotNowBlockerModule';
import type {
  BlockRule,
  InstalledApp,
  ScheduleWindow,
} from './src/NotNowBlocker.types';

export type {
  BlockRule,
  AndroidBlockRule,
  InstalledApp,
  ScheduleWindow,
} from './src/NotNowBlocker.types';

/**
 * Whether the blocking service is currently active.
 * Android: is the AccessibilityService enabled in system settings?
 * iOS (future): is Screen Time authorization granted?
 */
export function isAccessibilityServiceEnabled(): boolean {
  return NotNowBlockerModule.isAccessibilityServiceEnabled();
}

/**
 * Opens the system screen where the user can enable the service.
 * Android: the accessibility settings screen.
 * iOS (future): the FamilyControls authorization prompt.
 */
export function openAccessibilitySettings(): void {
  NotNowBlockerModule.openAccessibilitySettings();
}

/**
 * Pushes the blocklist to the native side. Plumbing, not user-facing:
 * called once on app launch (see App.tsx). On Android the rules are stored
 * in SharedPreferences, where the AccessibilityService — which runs with no
 * JS runtime attached — reads them.
 */
export function setBlocklist(rules: BlockRule[]): void {
  NotNowBlockerModule.setBlocklist(JSON.stringify(rules));
}

/**
 * Launchable apps on the device, sorted by label, excluding Not Now itself.
 * Android: PackageManager behind a launcher-intent <queries> declaration.
 * iOS (future): not applicable — FamilyActivityPicker is a system-provided
 * picker, so iOS never needs to enumerate apps in JS.
 */
export function getInstalledApps(): Promise<InstalledApp[]> {
  return NotNowBlockerModule.getInstalledApps();
}

/**
 * Package names the user chose to block entirely (via the in-app picker).
 * Persisted natively; the service sends these apps Home on open.
 * Separate from the screen rules in config/blocklist.ts on purpose — the
 * two are edited from different places and never overwrite each other.
 */
export function getBlockedApps(): string[] {
  return NotNowBlockerModule.getBlockedApps();
}

export function setBlockedApps(packageNames: string[]): void {
  NotNowBlockerModule.setBlockedApps(packageNames);
}

/**
 * Domains the user chose to block in browsers, e.g. "youtube.com" (also
 * blocks subdomains like m.youtube.com). Persisted natively; the service
 * watches supported browsers' URL bars and presses Back on a match.
 * iOS (future): maps cleanly to Screen Time's web-domain shielding
 * (ManagedSettingsStore.shield.webDomains).
 */
export function getBlockedWebsites(): string[] {
  return NotNowBlockerModule.getBlockedWebsites();
}

export function setBlockedWebsites(domains: string[]): void {
  NotNowBlockerModule.setBlockedWebsites(domains);
}

/**
 * Cleans user input down to a bare domain: trims, lowercases, strips
 * scheme/path/port and a leading "www.". Returns null if what's left
 * doesn't look like a domain.
 */
export function normalizeDomain(input: string): string | null {
  const domain = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z+]+:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split(':')[0];
  if (!domain.includes('.') || domain.includes(' ')) return null;
  return domain;
}

/** Minutes in a day — the unit schedule windows are expressed in. */
export const MINUTES_PER_DAY = 24 * 60;

/**
 * The windows during which blocking is enforced. An empty array means
 * blocking is always on (the behaviour before schedules existed), which is
 * also what a device with no saved schedule reports.
 *
 * Persisted natively, alongside the three blocklists, because the
 * accessibility service has to answer "should I be blocking right now?"
 * with no JS runtime attached.
 */
export function getSchedule(): ScheduleWindow[] {
  try {
    const parsed = JSON.parse(NotNowBlockerModule.getSchedule());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Never let a corrupt stored schedule stop the app from opening — the
    // app is the only place the user can repair it.
    return [];
  }
}

export function setSchedule(windows: ScheduleWindow[]): void {
  NotNowBlockerModule.setSchedule(JSON.stringify(windows));
}

/**
 * Whether `at` falls inside any window. This mirrors `ScheduleWindow.covers`
 * in BlocklistStore.kt — the service can't call into JS, so the rule is
 * necessarily expressed twice; keep the two in step.
 */
export function isWithinSchedule(windows: ScheduleWindow[], at: Date = new Date()): boolean {
  if (windows.length === 0) return true;
  const day = at.getDay();
  const minute = at.getHours() * 60 + at.getMinutes();
  return windows.some((w) => covers(w, day, minute));
}

function covers(window: ScheduleWindow, day: number, minute: number): boolean {
  if (window.endMinute > window.startMinute) {
    return window.days.includes(day) && minute >= window.startMinute && minute < window.endMinute;
  }
  // Wraps past midnight: either we're in the tail of a window that started
  // today, or in the head of one that started yesterday.
  const yesterday = (day + 6) % 7;
  return (
    (window.days.includes(day) && minute >= window.startMinute) ||
    (window.days.includes(yesterday) && minute < window.endMinute)
  );
}

/**
 * When the schedule next flips between blocking and not, or null if it
 * never does (no windows, or windows that between them cover every minute).
 *
 * Scans forward a minute at a time over one week rather than reasoning
 * about window boundaries directly. A week is 10,080 cheap iterations and
 * this runs at most twice a minute in the UI, so the simplicity is worth
 * more here than the cleverness would be — overlapping and midnight-wrapping
 * windows make the closed-form version genuinely easy to get wrong.
 */
export function nextScheduleChange(
  windows: ScheduleWindow[],
  at: Date = new Date(),
): Date | null {
  if (windows.length === 0) return null;
  const now = isWithinSchedule(windows, at);
  const cursor = new Date(at);
  cursor.setSeconds(0, 0);
  for (let i = 0; i < 7 * MINUTES_PER_DAY; i++) {
    cursor.setMinutes(cursor.getMinutes() + 1);
    if (isWithinSchedule(windows, cursor) !== now) return new Date(cursor);
  }
  return null;
}
