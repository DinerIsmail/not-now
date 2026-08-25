import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  getBlockedApps,
  getBlockedWebsites,
  isAccessibilityServiceEnabled,
  openAccessibilitySettings,
  setBlockedApps,
  setBlockedWebsites,
  setBlocklist,
} from './modules/not-now-blocker';
import { BLOCKLIST } from './config/blocklist';
import AppPicker from './AppPicker';
import WebsiteList from './WebsiteList';

type View_ = 'home' | 'apps' | 'websites';

export default function App() {
  const [enabled, setEnabled] = useState(false);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [websites, setWebsites] = useState<string[]>([]);
  const [view, setView] = useState<View_>('home');

  const refresh = useCallback(() => {
    setEnabled(isAccessibilityServiceEnabled());
  }, []);

  useEffect(() => {
    // Hand the blocklist to the native side once per launch; the
    // accessibility service reads it from SharedPreferences. The
    // user-picked blocked apps live under a separate key, so this never
    // overwrites them.
    setBlocklist(BLOCKLIST);
    setBlocked(getBlockedApps());
    setWebsites(getBlockedWebsites());
    refresh();

    // Enabling the service happens in system settings, outside the app —
    // re-check whenever we come back to the foreground.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

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

  if (view === 'apps') {
    return (
      <View style={styles.safeArea}>
        <AppPicker blocked={blocked} onToggle={toggleApp} onClose={() => setView('home')} />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (view === 'websites') {
    return (
      <View style={styles.safeArea}>
        <WebsiteList
          websites={websites}
          onAdd={addWebsite}
          onRemove={removeWebsite}
          onClose={() => setView('home')}
        />
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Not Now</Text>

      <View style={[styles.statusPill, enabled ? styles.statusOn : styles.statusOff]}>
        <Text style={styles.statusText}>
          {enabled ? 'Blocking is active' : 'Blocking is off'}
        </Text>
      </View>

      <Text style={styles.hint}>
        {enabled
          ? `${BLOCKLIST.length} screen rule${BLOCKLIST.length === 1 ? '' : 's'} from config/blocklist.ts, ` +
            `${blocked.length} app${blocked.length === 1 ? '' : 's'} and ` +
            `${websites.length} website${websites.length === 1 ? '' : 's'} blocked.`
          : Platform.OS === 'android'
            ? 'Enable the "Not Now screen blocker" accessibility service to start blocking.'
            : 'Blocking is only implemented on Android so far.'}
      </Text>

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

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
    // Clears the status bar; RN's SafeAreaView is deprecated and the
    // safe-area-context package isn't worth it for one screen.
    paddingTop: 56,
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
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
  statusOn: {
    backgroundColor: '#d8f3dc',
  },
  statusOff: {
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
