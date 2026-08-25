import { registerWebModule, NativeModule } from 'expo';

// Web stub so the app still type-checks and renders in a browser.
// Screen blocking is meaningless on web.
class FallowBlockerModule extends NativeModule<{}> {
  isAccessibilityServiceEnabled(): boolean {
    return false;
  }
  openAccessibilitySettings(): void {}
  setBlocklist(_rulesJson: string): void {}
  setBlockedApps(_packageNames: string[]): void {}
  getBlockedApps(): string[] {
    return [];
  }
  async getInstalledApps() {
    return [];
  }
  setBlockedWebsites(_domains: string[]): void {}
  getBlockedWebsites(): string[] {
    return [];
  }
}

export default registerWebModule(FallowBlockerModule, 'FallowBlocker');
