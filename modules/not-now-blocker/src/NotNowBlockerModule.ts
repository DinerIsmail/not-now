import { NativeModule, requireNativeModule } from 'expo';

import type { InstalledApp } from './NotNowBlocker.types';

declare class NotNowBlockerModule extends NativeModule<{}> {
  isAccessibilityServiceEnabled(): boolean;
  openAccessibilitySettings(): void;
  /** Takes the blocklist as a JSON string — see index.ts for the typed wrapper. */
  setBlocklist(rulesJson: string): void;
  setBlockedApps(packageNames: string[]): void;
  getBlockedApps(): string[];
  getInstalledApps(): Promise<InstalledApp[]>;
  setBlockedWebsites(domains: string[]): void;
  getBlockedWebsites(): string[];
  /** Takes the schedule as a JSON string — see index.ts for the typed wrapper. */
  setSchedule(windowsJson: string): void;
  getSchedule(): string;
}

export default requireNativeModule<NotNowBlockerModule>('NotNowBlocker');
