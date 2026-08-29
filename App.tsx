import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getBlockedApps,
  getBlockedWebsites,
  getSchedule,
  isAccessibilityServiceEnabled,
  isWithinSchedule,
  nextScheduleChange,
  openAccessibilitySettings,
  setBlockedApps,
  setBlockedWebsites,
  setBlocklist,
  setSchedule,
  type ScheduleWindow,
} from './modules/not-now-blocker';
import { BLOCKLIST } from './config/blocklist';
import AppPicker from './AppPicker';
import WebsiteList from './WebsiteList';
import ScheduleEditor, { describeWhen } from './ScheduleEditor';

type View_ = 'home' | 'apps' | 'websites' | 'schedule';

/**
 * How often the home screen re-checks the clock. The schedule can flip the
 * status pill without any user action, and a minute of lag on a purely
 * informational pill is not worth a finer-grained timer. Only runs while a
 * schedule actually exists.
 */
const CLOCK_TICK_MS = 30_000;

/**
 * Android is edge-to-edge from SDK 54 on and it cannot be turned off, so
 * every screen draws under the status bar and under the navigation bar —
 * including the 3-button one, which is tall enough to swallow a row of
 * buttons. The provider is what makes `useSafeAreaInsets` work; each screen
 * then pads itself, since they have different ideas about which edges
 * matter (a list wants its *content* inset, not its background).
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <NotNow />
    </SafeAreaProvider>
  );
}

function NotNow() {
  const insets = useSafeAreaInsets();
  const [enabled, setEnabled] = useState(false);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [websites, setWebsites] = useState<string[]>([]);
  const [schedule, setScheduleState] = useState<ScheduleWindow[]>([]);
  const [view, setView] = useState<View_>('home');
  // Bumped on a timer purely to re-evaluate the schedule against `new Date()`.
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    setEnabled(isAccessibilityServiceEnabled());
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    // Hand the blocklist to the native side once per launch; the
    // accessibility service reads it from SharedPreferences. The
    // user-picked blocked apps live under a separate key, so this never
    // overwrites them.
    setBlocklist(BLOCKLIST);
    setBlocked(getBlockedApps());
    setWebsites(getBlockedWebsites());
    setScheduleState(getSchedule());
    refresh();

    // Enabling the service happens in system settings, outside the app —
    // re-check whenever we come back to the foreground.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    if (schedule.length === 0) return;
    const timer = setInterval(() => setTick((t) => t + 1), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [schedule]);

  // Recomputed whenever the schedule changes or the clock ticks. `tick` is
  // in the deps for exactly that reason — the inputs are the schedule and
  // the current time, and only one of them is a value React can see.
  const { withinSchedule, nextChange } = useMemo(
    () => ({
      withinSchedule: isWithinSchedule(schedule),
      nextChange: nextScheduleChange(schedule),
    }),
    [schedule, tick],
  );

  const toggleApp = useCallback((packageName: string) => {
    setBlocked((previous) => {
      const next = previous.includes(packageName)
        ? previous.filter((p) => p !== packageName)
        : [...previous, packageName];
      // Persist immediately; the service picks the change up live.
      setBlockedApps(next);
      return next;
    });
  }, []);

  const addWebsite = useCallback((domain: string) => {
    setWebsites((previous) => {
      const next = [...previous, domain];
      setBlockedWebsites(next);
      return next;
    });
  }, []);

  const removeWebsite = useCallback((domain: string) => {
    setWebsites((previous) => {
      const next = previous.filter((d) => d !== domain);
      setBlockedWebsites(next);
      return next;
    });
  }, []);

  const addWindow = useCallback((window: ScheduleWindow) => {
    setScheduleState((previous) => {
      const next = [...previous, window];
      setSchedule(next);
      return next;
    });
  }, []);

  const removeWindow = useCallback((id: string) => {
    setScheduleState((previous) => {
      const next = previous.filter((w) => w.id !== id);
      setSchedule(next);
      return next;
    });
  }, []);

  if (view === 'apps') {
    return (
      <>
        <AppPicker blocked={blocked} onToggle={toggleApp} onClose={() => setView('home')} />
        <StatusBar style="auto" />
      </>
    );
  }

  if (view === 'websites') {
    return (
      <>
        <WebsiteList
          websites={websites}
          onAdd={addWebsite}
          onRemove={removeWebsite}
          onClose={() => setView('home')}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (view === 'schedule') {
    return (
      <>
        <ScheduleEditor
          schedule={schedule}
          onAdd={addWindow}
          onRemove={removeWindow}
          onClose={() => {
            setView('home');
            // Coming back from the editor, re-evaluate against the clock
            // rather than waiting out the rest of the tick interval.
            setTick((t) => t + 1);
          }}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  // Three states, not two: the service can be enabled but sitting outside
  // every scheduled window, which is neither "active" nor "off".
  const status = !enabled ? 'off' : withinSchedule ? 'on' : 'paused';

  return (
    <View
      style={[
        styles.container,
        // The buttons are the bottom-most thing on this screen, so without
        // the bottom inset the last one sits under the navigation bar.
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
      ]}
    >
      <Text style={styles.title}>Not Now</Text>

      <View style={[styles.statusPill, styles[`status_${status}`]]}>
        <Text style={styles.statusText}>
          {status === 'on'
            ? 'Blocking is active'
            : status === 'paused'
              ? 'Paused by schedule'
              : 'Blocking is off'}
        </Text>
      </View>

      <Text style={styles.hint}>
        {status === 'off'
          ? Platform.OS === 'android'
            ? 'Enable the "Not Now screen blocker" accessibility service to start blocking.'
            : 'Blocking is only implemented on Android so far.'
          : `${BLOCKLIST.length} screen rule${BLOCKLIST.length === 1 ? '' : 's'} from config/blocklist.ts, ` +
            `${blocked.length} app${blocked.length === 1 ? '' : 's'} and ` +
            `${websites.length} website${websites.length === 1 ? '' : 's'} blocked.`}
      </Text>

      {status !== 'off' && nextChange != null && (
        <Text style={styles.hint}>
          {withinSchedule ? 'Pauses' : 'Resumes'} {describeWhen(nextChange)}.
        </Text>
      )}

      <Pressable style={styles.button} onPress={openAccessibilitySettings}>
        <Text style={styles.buttonText}>Open accessibility settings</Text>
      </Pressable>

      <Pressable style={styles.buttonSecondary} onPress={() => setView('apps')}>
        <Text style={styles.buttonSecondaryText}>
          Choose apps to block{blocked.length > 0 ? ` (${blocked.length})` : ''}
        </Text>
      </Pressable>

      <Pressable style={styles.buttonSecondary} onPress={() => setView('websites')}>
        <Text style={styles.buttonSecondaryText}>
          Block websites{websites.length > 0 ? ` (${websites.length})` : ''}
        </Text>
      </Pressable>

      <Pressable style={styles.buttonSecondary} onPress={() => setView('schedule')}>
        <Text style={styles.buttonSecondaryText}>
          Blocking schedule{schedule.length > 0 ? ` (${schedule.length})` : ' — always on'}
        </Text>
      </Pressable>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    // Vertical padding is applied inline, on top of the safe-area insets.
    paddingHorizontal: 24,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
  },
  statusPill: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 999,
  },
  status_on: {
    backgroundColor: '#d8f3dc',
  },
  status_paused: {
    backgroundColor: '#fff3cd',
  },
  status_off: {
    backgroundColor: '#ffe5e5',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '500',
  },
  hint: {
    textAlign: 'center',
    color: '#555',
    maxWidth: 320,
  },
  button: {
    marginTop: 8,
    backgroundColor: '#1a1a1a',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
  },
  buttonSecondary: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  buttonSecondaryText: {
    color: '#1a1a1a',
    fontSize: 16,
  },
});
