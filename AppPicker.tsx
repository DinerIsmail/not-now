import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { getInstalledApps, type InstalledApp } from './modules/not-now-blocker';

type Props = {
  blocked: string[];
  onToggle: (packageName: string) => void;
  onClose: () => void;
};

/**
 * Full-screen list of launchable apps with a filter box; tapping a row
 * toggles whole-app blocking for it. Selection state lives in App.tsx.
 */
export default function AppPicker({ blocked, onToggle, onClose }: Props) {
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    getInstalledApps().then(setApps);
  }, []);

  const visible = apps?.filter(
    (app) =>
      app.label.toLowerCase().includes(filter.toLowerCase()) ||
      app.packageName.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <View style={styles.container}>
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

      {visible == null ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(app) => app.packageName}
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
});
