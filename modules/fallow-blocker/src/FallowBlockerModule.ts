import { NativeModule, requireNativeModule } from 'expo';

import type { InstalledApp } from './FallowBlocker.types';

declare class FallowBlockerModule extends NativeModule<{}> {
  isAccessibilityServiceEnabled(): boolean;
  openAccessibilitySettings(): void;
  /** Takes the blocklist as a JSON string — see index.ts for the typed wrapper. */
  setBlocklist(rulesJson: string): void;
  setBlockedApps(packageNames: string[]): void;
  getBlockedApps(): string[];
  getInstalledApps(): Promise<InstalledApp[]>;
  setBlockedWebsites(domains: string[]): void;
  getBlockedWebsites(): string[];
}

export default requireNativeModule<FallowBlockerModule>('FallowBlocker');
