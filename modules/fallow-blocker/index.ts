/**
 * Public, platform-neutral API of the fallow-blocker module.
 * App code should import from here and nowhere deeper.
 *
 * Android: implemented by FallowBlockerModule.kt + FallowAccessibilityService.kt.
 * iOS: currently a stub (see ios/FallowBlockerModule.swift). A future
 *      FamilyControls implementation slots in behind these same functions.
 */
import FallowBlockerModule from './src/FallowBlockerModule';
import type { BlockRule, InstalledApp } from './src/FallowBlocker.types';

export type { BlockRule, AndroidBlockRule, InstalledApp } from './src/FallowBlocker.types';

/**
 * Whether the blocking service is currently active.
 * Android: is the AccessibilityService enabled in system settings?
 * iOS (future): is Screen Time authorization granted?
 */
export function isAccessibilityServiceEnabled(): boolean {
  return FallowBlockerModule.isAccessibilityServiceEnabled();
}

/**
 * Opens the system screen where the user can enable the service.
 * Android: the accessibility settings screen.
 * iOS (future): the FamilyControls authorization prompt.
 */
export function openAccessibilitySettings(): void {
  FallowBlockerModule.openAccessibilitySettings();
}

/**
 * Pushes the blocklist to the native side. Plumbing, not user-facing:
 * called once on app launch (see App.tsx). On Android the rules are stored
 * in SharedPreferences, where the AccessibilityService — which runs with no
 * JS runtime attached — reads them.
 */
export function setBlocklist(rules: BlockRule[]): void {
  FallowBlockerModule.setBlocklist(JSON.stringify(rules));
}

/**
 * Launchable apps on the device, sorted by label, excluding Fallow itself.
 * Android: PackageManager behind a launcher-intent <queries> declaration.
 * iOS (future): not applicable — FamilyActivityPicker is a system-provided
 * picker, so iOS never needs to enumerate apps in JS.
 */
export function getInstalledApps(): Promise<InstalledApp[]> {
  return FallowBlockerModule.getInstalledApps();
}

/**
 * Package names the user chose to block entirely (via the in-app picker).
 * Persisted natively; the service sends these apps Home on open.
 * Separate from the screen rules in config/blocklist.ts on purpose — the
 * two are edited from different places and never overwrite each other.
 */
export function getBlockedApps(): string[] {
  return FallowBlockerModule.getBlockedApps();
}

export function setBlockedApps(packageNames: string[]): void {
  FallowBlockerModule.setBlockedApps(packageNames);
}

/**
 * Domains the user chose to block in browsers, e.g. "youtube.com" (also
 * blocks subdomains like m.youtube.com). Persisted natively; the service
 * watches supported browsers' URL bars and presses Back on a match.
 * iOS (future): maps cleanly to Screen Time's web-domain shielding
 * (ManagedSettingsStore.shield.webDomains).
 */
export function getBlockedWebsites(): string[] {
  return FallowBlockerModule.getBlockedWebsites();
}

export function setBlockedWebsites(domains: string[]): void {
  FallowBlockerModule.setBlockedWebsites(domains);
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
