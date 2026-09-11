import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getInstalledApps, type InstalledApp } from './modules/not-now-blocker';
import { DISTRACTING_APPS } from './config/distracting-apps';

type Props = {
  blocked: string[];
  onToggle: (packageName: string) => void;
  onClose: () => void;
};

/**
 * Package name → its position in `DISTRACTING_APPS`. Doubles as the
 * membership test ("is this one recommended?") and the sort key, so the
 * Recommended section comes out in the curated order rather than
 * alphabetically — the list is ordered by how distracting the app is.
 */
const RECOMMENDED_RANK = new Map(DISTRACTING_APPS.map((pkg, index) => [pkg, index]));

/**
 * Full-screen list of launchable apps with a filter box; tapping a row
 * toggles whole-app blocking for it. Selection state lives in App.tsx.
 *
 * Two things shape what you see, because the raw list is ~100 apps and
 * almost none of them are why you opened this screen:
 * - Anything in `config/distracting-apps.ts` that's installed is lifted to
 *   a "Recommended" section at the top.
 * - Apps that shipped with the device are hidden behind a toggle. A
 *   recommended app is never hidden by that rule (Chrome and YouTube are
 *   preinstalled), and neither is an app you've already blocked (hiding it
 *   would strand it as blocked with no way back).
 */
export default function AppPicker({ blocked, onToggle, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [filter, setFilter] = useState('');
  const [showSystem, setShowSystem] = useState(false);

  useEffect(() => {
    getInstalledApps().then(setApps);
  }, []);

  const { sections, hiddenCount } = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const matches = (app: InstalledApp) =>
      app.label.toLowerCase().includes(query) ||
      app.packageName.toLowerCase().includes(query);

    const recommended: InstalledApp[] = [];
    const rest: InstalledApp[] = [];
    let hidden = 0;

    for (const app of apps ?? []) {
      if (!matches(app)) continue;
      if (RECOMMENDED_RANK.has(app.packageName)) {
        recommended.push(app);
      } else if (app.isSystem && !showSystem && !blocked.includes(app.packageName)) {
        hidden++;
      } else {
        rest.push(app);
      }
    }

    recommended.sort(
      (a, b) =>
        (RECOMMENDED_RANK.get(a.packageName) ?? 0) -
        (RECOMMENDED_RANK.get(b.packageName) ?? 0),
    );

    return {
      sections: [
        { title: 'Recommended', data: recommended },
        { title: recommended.length > 0 ? 'All other apps' : 'All apps', data: rest },
      ].filter((section) => section.data.length > 0),
      hiddenCount: hidden,
    };
  }, [apps, filter, showSystem, blocked]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Block whole apps</Text>
      </View>

      <TextInput
        style={styles.filter}
        placeholder="Filter apps…"
        value={filter}
        onChangeText={setFilter}
        autoCorrect={false}
        autoCapitalize="none"
      />

      {apps == null ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(app) => app.packageName}
          // On the content rather than the container, so rows still scroll
          // under the translucent navigation bar instead of stopping short
          // of it — but the last row can always be scrolled clear of it.
          contentContainerStyle={{ paddingBottom: insets.bottom }}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.title === 'Recommended' && (
                <Text style={styles.sectionNote}>
                  The usual suspects
                </Text>
              )}
            </View>
          )}
          renderItem={({ item }) => {
            const isBlocked = blocked.includes(item.packageName);
            return (
              <Pressable style={styles.row} onPress={() => onToggle(item.packageName)}>
                {item.icon ? (
                  <Image source={{ uri: item.icon }} style={styles.icon} />
                ) : (
                  // Icon extraction can fail for an individual app, and iOS
                  // never provides one. An initial keeps the rows aligned.
                  <View style={[styles.icon, styles.iconFallback]}>
                    <Text style={styles.iconFallbackText}>
                      {item.label.trim().charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={styles.rowText}>
                  <Text style={styles.label}>{item.label}</Text>
                  <Text style={styles.packageName}>{item.packageName}</Text>
                </View>
                <Text style={[styles.check, !isBlocked && styles.checkOff]}>
                  {isBlocked ? '✓' : ''}
                </Text>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {hiddenCount > 0
                ? 'Nothing matches, but some built-in apps are hidden.'
                : 'No apps match that filter.'}
            </Text>
          }
          ListFooterComponent={
            hiddenCount > 0 || showSystem ? (
              <Pressable
                style={styles.systemToggle}
                onPress={() => setShowSystem((previous) => !previous)}
              >
                <Text style={styles.systemToggleText}>
                  {showSystem
                    ? 'Hide built-in apps'
                    : `Show ${hiddenCount} built-in app${hiddenCount === 1 ? '' : 's'}`}
                </Text>
              </Pressable>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    // The container supplies the status-bar inset; this is just breathing
    // room below it.
    paddingTop: 8,
    paddingBottom: 12,
  },
  back: {
    fontSize: 17,
    color: '#0a58ca',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  filter: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 16,
  },
  loading: {
    marginTop: 32,
  },
  sectionHeader: {
    // Opaque: section headers stick to the top on scroll, and a transparent
    // one would have rows sliding visibly underneath the text.
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionNote: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  iconFallback: {
    backgroundColor: '#eee',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconFallbackText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#888',
  },
  rowText: {
    flex: 1,
  },
  label: {
    fontSize: 16,
  },
  packageName: {
    fontSize: 12,
    color: '#888',
  },
  check: {
    fontSize: 18,
    color: '#2d6a4f',
    width: 24,
    textAlign: 'center',
  },
  checkOff: {
    color: 'transparent',
  },
  empty: {
    color: '#888',
    marginHorizontal: 16,
    marginTop: 16,
  },
  systemToggle: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  systemToggleText: {
    fontSize: 14,
    color: '#0a58ca',
  },
});
