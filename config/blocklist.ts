/**
 * ═══════════════════════════════════════════════════════════════════════
 *  NOT NOW BLOCKLIST — this file is the single source of truth.
 *
 *  Edit the entries below, then reload/relaunch the app once: App.tsx
 *  pushes this list to the native side on launch, and the accessibility
 *  service picks the change up immediately. No native rebuild needed.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { BlockRule } from '../modules/not-now-blocker';

export const BLOCKLIST: BlockRule[] = [
  // ⚠️ DISABLED — this rule was measured wrong, not just unverified.
  //
  // logcat on a Pixel 7a (2026-08-26) showed the service matching
  // `clips_viewer_view_pager` within 0.25–0.5s of Instagram *launching*, on
  // MainTabActivity — not on a reel. Instagram keeps the Reels pager
  // inflated inside its main tab activity, so the ID resolves everywhere in
  // the app: feed, stories, DMs. The whole app got blocked on open.
  //
  // The service now additionally requires a matched node to be visible on
  // screen, which neutralises this specific failure. Re-enable only with a
  // view ID inspected on your own Instagram build (README → "Finding view
  // IDs"), and confirm via `adb logcat -s NotNowBlocker` that the shield
  // goes up when you open a reel and stays down when you open the app.
  //
  // {
  //   label: 'Instagram Reels',
  //   android: {
  //     packageName: 'com.instagram.android',
  //     viewIds: ['com.instagram.android:id/<inspect this yourself>'],
  //     // contentDescriptions: ['Reels'],
  //   },
  // },
];
