/**
 * ═══════════════════════════════════════════════════════════════════════
 *  RECOMMENDED APPS TO BLOCK — the "Recommended" section of the picker.
 *
 *  Plain package names. Edit freely and reload; nothing here is pushed to
 *  the native side, so no rebuild is needed.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * This list does two jobs in `AppPicker.tsx`:
 *
 * 1. Any of these that is actually installed is offered first, under
 *    "Recommended", in the order below — so the apps you most likely came
 *    here to block are a tap away instead of a scroll away.
 * 2. None of these is ever hidden by the picker's system-app filter.
 *    Chrome, YouTube and (on many phones) Facebook ship preinstalled and
 *    are therefore "system" apps, but they're exactly the ones worth
 *    blocking. Everything preinstalled and *not* listed here — Clock,
 *    Calendar, Settings, the dialer — is hidden by default.
 *
 * Package names are stable and case-sensitive; find one you're missing
 * with `adb shell pm list packages | grep <name>`, or by turning on "Show
 * built-in apps" in the picker, which prints the package under each label.
 */
export const DISTRACTING_APPS: string[] = [
  // Social feeds — the endless-scroll core.
  'com.instagram.android', // Instagram
  'com.zhiliaoapp.musically', // TikTok
  'com.ss.android.ugc.trill', // TikTok (some regions ship this one instead)
  'com.facebook.katana', // Facebook
  'com.facebook.lite', // Facebook Lite
  'com.twitter.android', // X (Twitter)
  'com.reddit.frontpage', // Reddit
  'com.snapchat.android', // Snapchat
  'com.instagram.barcelona', // Threads
  'com.pinterest', // Pinterest
  'com.linkedin.android', // LinkedIn
  'com.tumblr', // Tumblr
  'xyz.blueskyweb.app', // Bluesky
  'org.joinmastodon.android', // Mastodon
  'com.ninegag.android.app', // 9GAG

  // Video — autoplay and "up next".
  'com.google.android.youtube', // YouTube
  'com.google.android.apps.youtube.music', // YouTube Music
  'tv.twitch.android.app', // Twitch
  'com.netflix.mediaclient', // Netflix
  'com.disney.disneyplus', // Disney+
  'com.amazon.avod.thirdpartyclient', // Prime Video

  // Chat — not idle scrolling, but the same pull-to-check habit.
  'com.facebook.orca', // Messenger
  'com.discord', // Discord
  'org.telegram.messenger', // Telegram
  'com.whatsapp', // WhatsApp

  // News.
  'com.google.android.apps.magazines', // Google News
  'bbc.mobile.news.uk', // BBC News
  'com.google.android.googlequicksearchbox', // Google (Discover feed)

  // Shopping.
  'com.amazon.mShop.android.shopping', // Amazon
  'com.ebay.mobile', // eBay
  'com.einnovation.temu', // Temu
  'com.zzkko', // SHEIN

  // Games with a daily loop.
  'com.king.candycrushsaga', // Candy Crush Saga
  'com.supercell.clashofclans', // Clash of Clans

  // Browsers — where every blocked site goes when its app is gone. The
  // website blocker (Block websites) is usually the better tool here;
  // these are listed so the option is at least visible.
  'com.android.chrome', // Chrome
  'org.mozilla.firefox', // Firefox
  'com.brave.browser', // Brave
  'com.sec.android.app.sbrowser', // Samsung Internet
];
