import { useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { normalizeDomain } from './modules/not-now-blocker';

type Props = {
  websites: string[];
  onAdd: (domain: string) => void;
  onRemove: (domain: string) => void;
  onClose: () => void;
};

/**
 * Manage blocked websites: type a domain, tap Add; tap ✕ to remove.
 * Unlike apps, websites can't be enumerated, so this is manual entry.
 * State lives in App.tsx.
 */
export default function WebsiteList({ websites, onAdd, onRemove, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState('');
  const [invalid, setInvalid] = useState(false);

  const add = () => {
    const domain = normalizeDomain(input);
    if (domain == null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setInput('');
    if (!websites.includes(domain)) onAdd(domain);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Block websites</Text>
      </View>

      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder="e.g. youtube.com"
          value={input}
          onChangeText={(text) => {
            setInput(text);
            setInvalid(false);
          }}
          onSubmitEditing={add}
          autoCorrect={false}
          autoCapitalize="none"
          keyboardType="url"
        />
        <Pressable style={styles.addButton} onPress={add}>
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>

      {invalid && <Text style={styles.error}>That doesn't look like a domain.</Text>}

      <Text style={styles.note}>
        Blocks the domain and its subdomains in supported browsers (Chrome,
        Firefox, Brave, Samsung Internet).
      </Text>

      <FlatList
        data={websites}
        keyExtractor={(domain) => domain}
        contentContainerStyle={{ paddingBottom: insets.bottom }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.domain}>{item}</Text>
            <Pressable onPress={() => onRemove(item)} hitSlop={12}>
              <Text style={styles.remove}>✕</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No websites blocked yet.</Text>}
      />
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
  addRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 16,
  },
  addButton: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
  },
  error: {
    color: '#b02a37',
    marginHorizontal: 16,
    marginBottom: 8,
  },
  note: {
    color: '#888',
    fontSize: 12,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  domain: {
    fontSize: 16,
  },
  remove: {
    fontSize: 16,
    color: '#b02a37',
    paddingHorizontal: 4,
  },
  empty: {
    textAlign: 'center',
    color: '#888',
    marginTop: 24,
  },
});
