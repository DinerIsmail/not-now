# Not Now

Personal-use app that blocks specific **screens inside apps** (not whole apps).
Android-first via an AccessibilityService; structured so an iOS Screen Time
implementation can be added later without a rewrite.

**Targets:** Expo SDK 57 (React Native 0.86), TypeScript, a development build
(not Expo Go — the custom native module requires one), and a local Expo module
written in Kotlin via the Expo Modules API.

## Project layout

```
App.tsx                        The single status screen
config/blocklist.ts            ← THE file you edit: the blocklist (typed)
modules/not-now-blocker/
  index.ts                     Public JS API (platform-neutral)
  src/                         Types + native module bindings
  android/                     Kotlin implementation (module, service,
                               manifest, accessibility XML config)
  ios/                         Stub — future FamilyControls home
```

## Running it

```sh
npm install
npx expo run:android    # builds the dev client and installs it on a
                        # connected device/emulator, then starts Metro
```

Subsequent JS-only changes hot-reload through `npx expo start`. Rebuild with
`npx expo run:android` only when you touch anything under
`modules/not-now-blocker/android/`.

Then, on the device:

1. Open the app → tap **Open accessibility settings**.
2. Find **Not Now screen blocker** → toggle it on (Android shows a warning
   that the service can read screen content — that's inherent to how this
   works; nothing leaves the device).
3. Return to the app; the status pill flips to "Blocking is active".

## Editing the blocklist

Everything lives in [`config/blocklist.ts`](config/blocklist.ts). On every
app launch the list is pushed to Android `SharedPreferences`, where the
accessibility service reads it — so after editing you only need to reload the
app (no native rebuild, no re-toggling the service).

A rule matches when the foreground window belongs to `packageName` **and**
the window contains any of the rule's `viewIds` (exact match) or
`contentDescriptions` (case-insensitive substring). On match the service
presses Back.

The seeded Instagram Reels entry is a **placeholder guess** — verify the
view ID against your installed Instagram version before trusting it.

## Blocking whole apps

Besides per-screen rules, the app has a picker (**Choose apps to block** on
the main screen) that lists every launchable app on the device; ticked apps
are blocked entirely. Selections are stored natively (SharedPreferences,
separate key from the screen rules — the two never overwrite each other) and
apply immediately, no app reload needed.

Two implementation notes:

- Whole-app blocks send the device **Home** rather than Back: Back from
  inside an app just climbs its own screen stack one blocked screen at a
  time.
- Listing other packages on Android 11+ requires a `<queries>` declaration
  (see the module's `AndroidManifest.xml`). We declare the launcher intent,
  which reveals exactly the apps with a home-screen icon — deliberately
  narrower than the `QUERY_ALL_PACKAGES` permission. Not Now itself is
  excluded from the list so you can't lock yourself out of the app you'd
  need to undo it (the service also refuses to act on Not Now's own package
  as a second line of defence).

## Blocking websites

**Block websites** on the main screen opens a manual list: type a domain
(any pasted URL is normalized down to its domain), and the service blocks it
— and its subdomains — in supported browsers by watching the browser's URL
bar and pressing Back when a blocked domain appears.

How it works, and its limits:

- Supported browsers are a hardcoded map of package name → URL-bar view ID
  (`BROWSER_URL_BARS` in `NotNowAccessibilityService.kt`): Chrome, Chrome
  Beta, Brave, Firefox, Samsung Internet. Add your browser by finding its
  URL bar's view ID (section below) and extending the map (needs a rebuild).
- This required widening the service to `typeWindowContentChanged` events,
  since navigating within a browser never changes windows. Those events are
  frequent, so the service ignores them for every package except known
  browsers.
- While the URL bar is focused (you're typing in it) the service stays
  quiet; enforcement happens once navigation commits.
- Not covered: in-app webviews (e.g. links opened inside Instagram),
  browsers not in the map, and anything DNS-level. This is a nudge, not a
  firewall.

## Finding view IDs for a screen

The blocklist needs the *resource ID* of a view that exists on the screen you
want to block (and ideally nowhere else in that app). Two ways to find it:

### Option A — Android Studio Layout Inspector

1. Connect your device (USB debugging on) and open Android Studio (any
   project — this one after `npx expo run:android` works).
2. On the device, navigate to the screen you want to block (e.g. open a
   Reel) and *stay on it*.
3. In Android Studio: **Tools → Layout Inspector** (in recent versions it's
   embedded in the Running Devices window). Pick your device, then the
   foreground process.
   - **Caveat:** live inspection of release apps you don't own (like
     Instagram) is restricted on many devices. If the process doesn't
     appear or shows an empty tree, use Option B — it always works.
4. Click elements in the rendered screen; the attributes panel shows each
   node's `id`. Prefix it with the package to get the fully-qualified form
   the blocklist needs: `com.instagram.android:id/<id>`.
5. Pick an ID unique to that screen — a pager/container for the screen
   itself, not a like button that also appears elsewhere.

### Option B — `adb shell uiautomator dump` (works on any app, no Studio)

`uiautomatorviewer` was removed from recent Android SDK tools, but the
underlying dump still works:

```sh
# With the target screen open on the device:
adb shell uiautomator dump          # writes /sdcard/window_dump.xml
adb pull /sdcard/window_dump.xml .
```

Open `window_dump.xml`: every node has a `resource-id` attribute already in
fully-qualified form (`com.instagram.android:id/...`) plus `content-desc`.
Search for distinctive nodes, then diff against a dump taken on a screen you
*don't* want blocked to find IDs unique to the target screen.

### Verifying a rule

Add the ID to `config/blocklist.ts`, reload the app, open the target screen.
It should immediately back out. Watch the service's logs while testing:

```sh
adb logcat -s NotNowBlocker
```

If nothing fires, the screen may not emit a window *state* change (some
in-app navigation only emits *content* changes) — see the `eventTypes`
comment in
`modules/not-now-blocker/android/src/main/res/xml/not_now_accessibility_service.xml`.

## What's Android-specific vs. where iOS slots in

**Cross-platform (stays as-is):**
`App.tsx`, `config/blocklist.ts`, and `modules/not-now-blocker/index.ts` — the
public API (`isAccessibilityServiceEnabled`, `openAccessibilitySettings`,
`setBlocklist`) is deliberately platform-neutral.

**Android-specific (everything under `modules/not-now-blocker/android/`):**
the Expo module, the AccessibilityService, the SharedPreferences handoff, the
manifest service declaration, and the accessibility XML config.

**iOS (future) — `modules/not-now-blocker/ios/NotNowBlockerModule.swift`:**
currently a stub returning `false`/no-ops so the app runs on iOS unchanged.
The real implementation would use the Screen Time stack — FamilyControls for
authorization, ManagedSettings for shielding, DeviceActivity for scheduling —
behind the same three functions. Two structural notes already accounted for:

- iOS **cannot block screens within an app**, only whole apps/categories/web
  domains. That's why `BlockRule` has a per-platform `android` key and a
  reserved `ios` key rather than one shared shape.
- The app target will need the Family Controls entitlement (Apple approval
  required for distribution) — an `app.json`/config-plugin concern, not a
  module rewrite.
