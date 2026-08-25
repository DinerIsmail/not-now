/**
 * Public, platform-neutral API of the not-now-blocker module.
 * App code should import from here and nowhere deeper.
 *
 * Android: implemented by NotNowBlockerModule.kt + NotNowAccessibilityService.kt.
 * iOS: currently a stub (see ios/NotNowBlockerModule.swift). A future
 *      FamilyControls implementation slots in behind these same functions.
 */
import NotNowBlockerModule from './src/NotNowBlockerModule';
import type { BlockRule, InstalledApp } from './src/NotNowBlocker.types';

export type { BlockRule, AndroidBlockRule, InstalledApp } from './src/NotNowBlocker.types';

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
