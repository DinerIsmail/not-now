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
  {
    label: 'Instagram Reels',
    android: {
      packageName: 'com.instagram.android',
      // ⚠️ PLACEHOLDER — UNVERIFIED. This is a plausible guess at the Reels
      // pager's view ID, not an inspected one. Instagram renames internals
      // between releases. Verify against YOUR installed version using the
      // "Finding view IDs" section of the README, and replace.
      viewIds: ['com.instagram.android:id/clips_viewer_view_pager'],
      // Optional fallback matching: uncomment and adjust after inspecting.
      // contentDescriptions: ['Reels'],
    },
  },
];
