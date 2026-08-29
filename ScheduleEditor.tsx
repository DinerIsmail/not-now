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

import {
  isWithinSchedule,
  nextScheduleChange,
  type ScheduleWindow,
} from './modules/not-now-blocker';

type Props = {
  schedule: ScheduleWindow[];
  onAdd: (window: ScheduleWindow) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
};

/** Sunday-first, matching JS `Date#getDay` — the numbering the model uses. */
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Minutes from midnight → "09:00". 24h, because the input is 24h too. */
export function formatMinute(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** "Every day" / "Weekdays" / "Weekends" / "Mon, Thu" for anything else. */
export function formatDays(days: number[]): string {
  const set = new Set(days);
  if (set.size === 7) return 'Every day';
  const isEvery = (candidates: number[]) =>
    candidates.length === set.size && candidates.every((d) => set.has(d));
  if (isEvery([1, 2, 3, 4, 5])) return 'Weekdays';
  if (isEvery([0, 6])) return 'Weekends';
  return [...set].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(', ');
}

/**
 * Accepts "9", "930", "9:30", "09:30" — all the ways someone types a time
 * into a plain text box. Returns minutes from midnight, or null.
 *
 * A text field rather than a native time picker on purpose: the picker
 * would mean a new native dependency (and so a rebuild for anyone pulling
 * this) to enter four digits.
 */
export function parseTime(input: string): number | null {
  const match = /^(\d{1,2})(?::?(\d{2}))?$/.exec(input.trim());
  if (match == null) return null;
  const hours = Number(match[1]);
  const minutes = match[2] == null ? 0 : Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

const DAY_PRESETS: { label: string; days: number[] }[] = [
  { label: 'Every day', days: [0, 1, 2, 3, 4, 5, 6] },
  { label: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { label: 'Weekends', days: [0, 6] },
];

/**
 * Manage the blocking schedule: a list of recurring windows, each a set of
 * days plus a start and end time. Blocking is enforced inside any window;
 * with no windows at all it runs around the clock. State lives in App.tsx.
 */
export default function ScheduleEditor({ schedule, onAdd, onRemove, onClose }: Props) {
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('17:00');
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const active = isWithinSchedule(schedule);
  const nextChange = nextScheduleChange(schedule);

  const toggleDay = (day: number) => {
    setError(null);
    setDays((previous) =>
      previous.includes(day) ? previous.filter((d) => d !== day) : [...previous, day],
    );
  };

  const add = () => {
    if (days.length === 0) {
      setError('Pick at least one day.');
      return;
    }
    const startMinute = parseTime(from);
    const endMinute = parseTime(to);
    if (startMinute == null || endMinute == null) {
      setError('Times must look like 09:00.');
      return;
    }
    setError(null);
    onAdd({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      days: [...days].sort((a, b) => a - b),
      startMinute,
      endMinute,
    });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Blocking schedule</Text>
      </View>

      <View style={[styles.statusPill, active ? styles.statusOn : styles.statusOff]}>
        <Text style={styles.statusText}>
          {schedule.length === 0
            ? 'Always on — no schedule set'
            : active
              ? 'Blocking now'
              : 'Paused — outside every window'}
        </Text>
      </View>

      {nextChange != null && (
        <Text style={styles.note}>
          {active ? 'Pauses' : 'Resumes'} {describeWhen(nextChange)}.
        </Text>
      )}

      <View style={styles.form}>
        <Text style={styles.formTitle}>Add a window</Text>

        <View style={styles.dayRow}>
          {DAY_LABELS.map((label, day) => {
            const on = days.includes(day);
            return (
              <Pressable
                key={label}
                style={[styles.dayPill, on && styles.dayPillOn]}
                onPress={() => toggleDay(day)}
              >
                <Text style={[styles.dayPillText, on && styles.dayPillTextOn]}>
                  {label[0]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.presetRow}>
          {DAY_PRESETS.map((preset) => (
            <Pressable
              key={preset.label}
              style={styles.preset}
              onPress={() => {
                setError(null);
                setDays(preset.days);
              }}
            >
              <Text style={styles.presetText}>{preset.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.timeRow}>
          <Text style={styles.timeLabel}>From</Text>
          <TextInput
            style={styles.timeInput}
            value={from}
            onChangeText={(text) => {
              setFrom(text);
              setError(null);
            }}
            placeholder="09:00"
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
          />
          <Text style={styles.timeLabel}>to</Text>
          <TextInput
            style={styles.timeInput}
            value={to}
            onChangeText={(text) => {
              setTo(text);
              setError(null);
            }}
            placeholder="17:00"
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
          />
          <Pressable style={styles.addButton} onPress={add}>
            <Text style={styles.addButtonText}>Add</Text>
          </Pressable>
        </View>

        {error != null && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.hint}>
          24-hour times. An end earlier than the start runs overnight into the
          next morning (22:00 – 06:00), and an end of 00:00 means midnight.
        </Text>
      </View>

      <FlatList
        data={schedule}
        keyExtractor={(window) => window.id}
        style={styles.list}
        contentContainerStyle={{ paddingBottom: insets.bottom }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowDays}>{formatDays(item.days)}</Text>
              <Text style={styles.rowTimes}>{formatWindow(item)}</Text>
            </View>
            <Pressable onPress={() => onRemove(item.id)} hitSlop={12}>
              <Text style={styles.remove}>✕</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No windows yet, so blocking runs around the clock. Add one to limit
            it to certain times.
          </Text>
        }
      />
    </View>
  );
}

/**
 * The time half of a window's summary. An end at or before the start wraps
 * past midnight, which covers both the useful cases the naive reading gets
 * wrong: 22:00 – 06:00 is one overnight stretch, and equal times are a full
 * 24 hours rather than a zero-length window.
 */
export function formatWindow(window: ScheduleWindow): string {
  const range = `${formatMinute(window.startMinute)} – ${formatMinute(window.endMinute)}`;
  if (window.startMinute === window.endMinute) return `All day (${range})`;
  return window.endMinute < window.startMinute ? `${range} (next day)` : range;
}

/** "at 17:00" for later today, "on Mon at 09:00" for anything further out. */
export function describeWhen(when: Date): string {
  const time = formatMinute(when.getHours() * 60 + when.getMinutes());
  const isToday = when.getDate() === new Date().getDate();
  return isToday ? `at ${time}` : `on ${DAY_LABELS[when.getDay()]} at ${time}`;
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
  statusPill: {
    alignSelf: 'flex-start',
    marginHorizontal: 16,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 999,
  },
  statusOn: {
    backgroundColor: '#d8f3dc',
  },
  statusOff: {
    backgroundColor: '#eee',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
  },
  note: {
    color: '#888',
    fontSize: 12,
    marginHorizontal: 16,
    marginTop: 6,
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rowText: {
    flex: 1,
  },
  rowDays: {
    fontSize: 16,
  },
  rowTimes: {
    fontSize: 13,
    color: '#888',
  },
  remove: {
    fontSize: 16,
    color: '#b02a37',
    paddingHorizontal: 4,
  },
  empty: {
    color: '#888',
    marginHorizontal: 16,
    marginTop: 16,
  },
  form: {
    // The form sits above the list, not below it: pinned to the bottom of
    // the screen the software keyboard covered the inputs it was opened
    // for. This also matches WebsiteList, where the add row is at the top.
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    padding: 16,
    gap: 10,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  dayRow: {
    flexDirection: 'row',
    gap: 6,
  },
  dayPill: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayPillOn: {
    backgroundColor: '#1a1a1a',
    borderColor: '#1a1a1a',
  },
  dayPillText: {
    fontSize: 14,
    color: '#555',
  },
  dayPillTextOn: {
    color: '#fff',
    fontWeight: '600',
  },
  presetRow: {
    flexDirection: 'row',
    gap: 8,
  },
  preset: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#f2f2f2',
  },
  presetText: {
    fontSize: 12,
    color: '#555',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeLabel: {
    fontSize: 14,
    color: '#555',
  },
  timeInput: {
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
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
  },
  error: {
    color: '#b02a37',
  },
  hint: {
    color: '#888',
    fontSize: 12,
  },
});
