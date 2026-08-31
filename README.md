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
AppPicker.tsx                  Whole-app blocking picker
WebsiteList.tsx                Blocked-domain list
ScheduleEditor.tsx             When blocking applies
config/blocklist.ts            ← THE file you edit: the blocklist (typed)
modules/not-now-blocker/
  index.ts                     Public JS API (platform-neutral)
  src/                         Types + native module bindings
  android/                     Kotlin implementation (module, service,
                               block overlay, manifest, accessibility XML)
  ios/                         Stub — future FamilyControls home
```

## Running it

```sh
npm install
npm run android          # or: npm run android:device  (pick a physical device)
```

That produces a **development build** — a debug APK with the `expo-dev-client`
launcher and this project's Kotlin module compiled in — installs it, and starts
Metro. This is a one-time cost per native change, not per edit.

Then, on the device:

1. Open the app → tap **Open accessibility settings**.
2. Find **Not Now screen blocker** → toggle it on (Android shows a warning
   that the service can read screen content — that's inherent to how this
   works; nothing leaves the device).
3. Return to the app; the status pill flips to "Blocking is active".

## Shipping updates while developing

Almost everything you'll iterate on is JavaScript, and **JS changes need no
rebuild and no reinstall**. Leave the dev build installed and re-serve the
bundle:

```sh
npm run start            # phone on the same wifi as your machine
npm run start:tunnel     # phone on any network (tunnels via ngrok)
npm run start -- --clear # same, but bust the Metro cache
```

The dev launcher opens on app start: scan the QR code from the terminal, or
tap the dev server if it's auto-detected on your network. After that, saving a
file reloads the app. Shake the device (or the dev menu) to reload manually or
switch servers — the launcher can point at a different dev server without
recompiling.

### What needs a new APK

| Change | Then |
|---|---|
| `App.tsx`, `AppPicker.tsx`, `WebsiteList.tsx`, `ScheduleEditor.tsx` | reload — no rebuild |
| `config/blocklist.ts` | reload — see below |
| `modules/not-now-blocker/index.ts`, `src/*.ts` | reload — no rebuild |
| Anything under `modules/not-now-blocker/android/` | `npm run android` |
| New dependency with native code, or an SDK bump | `npm run android` |
| `app.json` native keys (package name, icons, permissions) | `npm run prebuild` then `npm run android` |

Blocklist edits are the nice case: the JS reload pushes the new rules into
`SharedPreferences` and the accessibility service picks them up live — no
rebuild, and no re-toggling the service in settings.

### Releasing a new version to your phone

`npm run release` builds a **signed, standalone release APK** — no Metro, no
dev launcher, no USB, no developer mode on the phone. Add `--publish` and it
also tags the commit and puts the APK on a GitHub Release, so installing is
"open a link in the phone's browser and tap the download".

```sh
npm run release                       # build dist/not-now-<version>.apk
npm run release -- --publish          # ...and publish it as a GitHub Release
npm run release -- minor --publish    # bump minor rather than patch
npm run release -- --no-bump          # rebuild the current version
```

Then on the phone, open the URL the script prints —
`https://github.com/<you>/not-now/releases/download/v<x.y.z>/not-now-<x.y.z>.apk`
— tap the download, tap install. Android asks once for permission to install
unknown apps from your browser; that's a normal per-app setting under
**Settings → Apps → Special app access**, nothing to do with developer mode.

**The first release is a fresh install, not an upgrade.** The dev build on your
phone is signed with Android's shared debug key and this one isn't, so Android
refuses to install over it: uninstall Not Now first, then install the release
and re-toggle the accessibility service. Every release after that upgrades in
place, keeping the blocklist and the accessibility toggle intact.

Three pieces of state make that true, and are worth understanding before
changing anything here:

- **`release.jks` and `release-keystore.properties`** (project root, both
  gitignored) are generated on the first run. Android only installs an update
  over an app signed with the *same* key, so these two files are the only
  reason a future release is an upgrade rather than an uninstall-and-start-over.
  **Back them up off this machine** — they cannot be regenerated.
- **`android.versionCode`** in `app.json` counts up on every release. It is what
  Android actually compares; `version` (`1.2.3`) is only ever shown to humans.
  It must never go backwards, so let the script own it.
- Signing is applied by a config plugin,
  [`plugins/withReleaseSigning.js`](plugins/withReleaseSigning.js), rather than
  by editing `android/app/build.gradle` — `android/` is generated and
  gitignored, so a hand-edit there is wiped by the next `expo prebuild`. With no
  keystore present the plugin falls back to the debug key, so a fresh clone
  still builds.

`--publish` refuses to run on a dirty working tree (`--allow-dirty` overrides),
so a published tag always corresponds to a commit. The APK is a universal build
(~66 MB, all four ABIs); restricting `reactNativeArchitectures` to `arm64-v8a`
would roughly halve it at the cost of x86 emulator builds — not worth it unless
the size starts to bother you.

The alternative to all of this is a hosted service: EAS Build's internal
distribution (free tier: 15 Android builds/month, low-priority queue) or
Firebase App Distribution. Both hand you an install page and hold the keystore
for you; neither is faster than a local build on a machine that already has the
Android toolchain.

### Reinstalling over USB

```sh
npx expo run:android --binary path/to.apk   # install an APK you already built
```

Saves a rebuild when you just need to reinstall. Note that `android/` is
generated and gitignored: regenerate it with `npm run prebuild` after changing
native config.

## Layout: edge-to-edge and the keyboard

Android has been edge-to-edge since Expo SDK 54 / RN 0.81 (targeting Android
16) and **it cannot be turned off**. Every screen therefore draws underneath
the status bar and underneath the navigation bar — and the 3-button
navigation bar is tall enough to swallow a whole row of buttons. Two rules
follow, and new screens have to keep to both:

- Read insets from `useSafeAreaInsets()` (`react-native-safe-area-context`,
  the package Expo points at for this). `SafeAreaProvider` is installed once,
  at the root of `App.tsx`; each screen pads itself from there, because they
  disagree about which edge matters. The home screen pads its *container*
  top and bottom, since its buttons are the bottom-most thing on it. The list
  screens pad the top of the container but put the bottom inset on the
  `FlatList`'s `contentContainerStyle`, so rows still scroll under the
  translucent navigation bar while the last row can always be scrolled clear
  of it.
- Keep text inputs in the **top half** of a screen. Edge-to-edge also means
  the window no longer resizes for the software keyboard by itself, so a form
  pinned to the bottom gets covered by the very keyboard it opened — which is
  exactly what happened to the schedule editor's time fields. Its "Add a
  window" form sits above the list for that reason, matching the add row in
  `WebsiteList`. The alternative is `KeyboardAvoidingView` or
  `react-native-keyboard-controller`; laying the screen out so the problem
  can't arise is cheaper and has fewer edge cases.

## Editing the blocklist

Everything lives in [`config/blocklist.ts`](config/blocklist.ts). On every
app launch the list is pushed to Android `SharedPreferences`, where the
accessibility service reads it — so after editing you only need to reload the
app (no native rebuild, no re-toggling the service).

A rule matches when the foreground window belongs to `packageName` **and**
the window contains any of the rule's `viewIds` (exact match) or
`contentDescriptions` (case-insensitive substring). On match the service
puts a shield over the screen (see "How blocking behaves" below); the rule's
`label` is what the shield says.

The seeded Instagram Reels entry is a **placeholder guess** — verify the
view ID against your installed Instagram version before trusting it.

## Blocking whole apps

Besides per-screen rules, the app has a picker (**Choose apps to block** on
the main screen) that lists every launchable app on the device; ticked apps
are blocked entirely. Selections are stored natively (SharedPreferences,
separate key from the screen rules — the two never overwrite each other) and
apply immediately, no app reload needed.

Two implementation notes:

- The shield over a blocked app offers **Home** rather than Back: Back from
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

- A blocked page is **covered**, not closed — see "How blocking behaves".
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

## How blocking behaves

When the service finds blocked content it puts a **shield** over it: a
full-screen overlay naming what is blocked, with one button to leave ("Go
back" for a screen or a website, "Go home" for a whole app). It does not
navigate for you.

It used to. The service fired Back or Home the instant it matched, and in a
browser that was actively wrong: Back on a blocked page in a fresh tab has
nowhere to go, so it closed the browser. Shielding leaves you where you are
and makes leaving your decision — the same model as an iOS Screen Time
shield.

The mechanism is `WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY`
(`BlockOverlay.kt`), which is the one overlay type an AccessibilityService
may post on the strength of `BIND_ACCESSIBILITY_SERVICE` alone. No
`SYSTEM_ALERT_WINDOW`, so there is no "display over other apps" permission
for you to grant. Four details are load-bearing:

- **`FLAG_NOT_FOCUSABLE`.** Keeps the overlay out of the accessibility
  framework's idea of the "active window", so `rootInActiveWindow` still
  returns the app underneath and the service can keep asking whether the
  shield is still needed. It also leaves the Back key with that app.
  `FLAG_NOT_TOUCHABLE` is pointedly *not* set, so touches land on the shield
  and the UI beneath it can't be tapped through.
- **`fitInsetsTypes = systemBars()`** (API 30+). An accessibility overlay is
  layered *above* the navigation bar, so a full-screen one can cover it — and
  a shield that swallows the Home button leaves its own button as your only
  way out. Insetting the window keeps the system bars usable whatever else
  goes wrong.
- **Views built in code, not XML.** The service has no app theme attached, so
  an inflated layout would resolve theme attributes against nothing.
- **A failed `addView` falls back to ejecting.** A shield that doesn't appear
  must not silently mean "not blocked".

Shielding also deleted a class of bug. Ejecting was destructive and couldn't
be repeated, so it needed an edge-trigger latch and two cooldowns to stop it
re-firing while a blocked screen sat in the window tree — the mechanism that
used to close the comments sheet you'd just opened over a blocked reel.
Showing a shield is idempotent (re-showing the same one is a no-op), so the
service now just answers "is this blocked right now?" on every event and
keeps the overlay in step. What remains is a 250ms throttle on
content-changed events, and one asymmetry worth knowing about:

A third timing rule exists purely to stop the shield fighting the exit it
just offered. Leaving is not instant — a browser's URL bar still reads the
blocked domain for a few hundred milliseconds after Back is pressed — so
tapping the button starts a **1.5s window during which no shield may go up**.
Without it the shield sprang back up mid-navigation, you pressed "Go back" a
second time, and that second press (arriving once the tab had already rewound
to a page with nothing behind it) is what closed the browser. The button also
disables itself on first press, so a double tap can't send two Backs either.
Both were fixed together; either one alone still leaves the other route open.

> The shield goes up immediately and comes down slowly. Being late to shield
> is the failure that matters; meanwhile "I couldn't find the URL bar in this
> frame" and "the user has left" look identical from here, so the shield
> waits ~600ms of agreement before dropping. The wait is skipped when the
> foreground app changes or a window-state event says you genuinely
> navigated, so leaving never feels sticky.

One consequence to be aware of: a shielded screen is covered, not stopped. A
blocked video behind the shield keeps playing its audio until you leave.

## Scheduling when blocking applies

**Blocking schedule** on the main screen limits blocking to certain times.
The schedule is **global**: it gates all three kinds of block (screen rules,
whole apps, websites) rather than being attached to any one of them.

A schedule is a list of *windows*, each a set of days plus a start and end
time. Blocking is enforced whenever the current local time falls inside any
window; with **no windows at all, blocking runs around the clock** — which is
what the app did before schedules existed, so nothing changes until you set
one. The main screen's status pill gains a third state, "Paused by
schedule", and tells you when blocking next resumes.

Reading the times:

- 24-hour clock, typed as text (`9`, `930`, `9:30` and `09:30` all work).
  A native time picker would mean a new native dependency, and so a rebuild,
  to enter four digits.
- An end **earlier than** the start runs overnight into the next morning:
  `22:00 – 06:00` on Fridays is Friday night through Saturday morning. A
  window is anchored to the day it *starts* on.
- An end of `00:00` means midnight, so `09:00 – 00:00` covers a whole
  evening.
- Equal start and end times mean a full 24 hours on the selected days,
  shown in the list as "All day".

Two implementation notes:

- The rule is evaluated in two places — `isWithinSchedule` in
  `modules/not-now-blocker/index.ts` for the UI, and `ScheduleWindow.covers`
  in `BlocklistStore.kt` for the service. The accessibility service has no JS
  runtime attached, so it can't share the JS one. **Change one and you must
  change the other.**
- The service checks the schedule *first*, before any window inspection, so
  an out-of-hours event costs a clock read and nothing more. The answer is
  cached for a second, since content-changed events arrive dozens per second
  in a browser but the answer only changes on a minute boundary. A schedule
  edit invalidates that cache immediately.

A schedule the service can't parse fails **open** — back to blocking around
the clock — rather than silently switching the app off.

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
`App.tsx`, the three editor screens, `config/blocklist.ts`, and
`modules/not-now-blocker/index.ts` — the public API
(`isAccessibilityServiceEnabled`, `openAccessibilitySettings`,
`setBlocklist`, `getSchedule`/`setSchedule`, …) is deliberately
platform-neutral. The schedule's evaluation helpers live there too, as plain
functions over `ScheduleWindow[]` with no platform dependency.

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
- The **schedule** is the piece that maps to iOS most cleanly:
  `DeviceActivitySchedule` takes exactly this shape — a recurring wall-clock
  interval — and applies and lifts the `ManagedSettings` shield at its
  edges. iOS would enforce the schedule natively at the window boundaries
  rather than consulting the clock on every event as Android does.
