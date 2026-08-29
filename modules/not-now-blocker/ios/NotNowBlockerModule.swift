import ExpoModulesCore

// iOS STUB — not yet implemented.
//
// iOS has no AccessibilityService equivalent: apps cannot observe or act on
// another app's UI, so per-screen blocking as done on Android is impossible.
// The closest iOS can get is the Screen Time stack:
//
//   - FamilyControls: request Screen Time authorization
//     (AuthorizationCenter.shared.requestAuthorization) and let the user
//     pick apps via FamilyActivityPicker.
//   - ManagedSettings: apply a shield to the selected apps/categories.
//   - DeviceActivity: schedules and usage-threshold monitoring.
//
// That blocks whole apps/categories/web domains, not screens within an app.
// When implemented, it slots in behind these same three functions:
//
//   isAccessibilityServiceEnabled -> AuthorizationCenter.shared
//                                      .authorizationStatus == .approved
//   openAccessibilitySettings     -> requestAuthorization(for: .individual)
//   setBlocklist                  -> map rules' (future) `ios` key to
//                                    ManagedSettingsStore.shield
//
// It also requires the "Family Controls" capability/entitlement on the app
// target, which needs approval from Apple for distribution builds.
public class NotNowBlockerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NotNowBlocker")

    Function("isAccessibilityServiceEnabled") { () -> Bool in
      return false
    }

    Function("openAccessibilitySettings") {
      // No-op until the FamilyControls implementation lands.
    }

    Function("setBlocklist") { (_ rulesJson: String) in
      // No-op: rules currently have no `ios` key to apply.
    }

    Function("setBlockedApps") { (_ packageNames: [String]) in
      // No-op. On iOS whole-app blocking would not go through package
      // names at all: FamilyActivityPicker hands back opaque
      // ApplicationTokens, applied via ManagedSettingsStore.shield.
    }

    Function("getBlockedApps") { () -> [String] in
      return []
    }

    AsyncFunction("getInstalledApps") { () -> [[String: String]] in
      // iOS cannot enumerate installed apps (no PackageManager
      // equivalent, by design). The FamilyControls flow never needs to:
      // FamilyActivityPicker is a system UI that does the picking itself.
      return []
    }

    Function("setBlockedWebsites") { (_ domains: [String]) in
      // No-op. Of the three block kinds, this one maps to iOS most
      // directly: ManagedSettingsStore.shield.webDomains takes literal
      // web domains and shields them in Safari.
    }

    Function("getBlockedWebsites") { () -> [String] in
      return []
    }

    Function("setSchedule") { (_ windowsJson: String) in
      // No-op. This is the other piece that maps cleanly to iOS:
      // DeviceActivitySchedule takes exactly this shape — a recurring
      // wall-clock interval — and applies/lifts the ManagedSettings shield
      // at its edges, so iOS would enforce the schedule natively rather
      // than checking the clock on every event as Android does.
      _ = windowsJson
    }

    Function("getSchedule") { () -> String in
      // An empty array: no schedule, i.e. block around the clock — which
      // for the stub means block nothing at all, around the clock.
      return "[]"
    }
  }
}
