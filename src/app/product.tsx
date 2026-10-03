import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import {
  getItem,
  getItemTotals,
  isLowStock,
  listMovements,
  type Item,
  type ItemTotals,
  type Movement,
  type MovementType,
} from '@/db/inventory';
import { useTheme } from '@/hooks/use-theme';
import { useSync } from '@/providers/sync-provider';
import { formatDate, formatMoney } from '@/utils/format';

type Data = { item: Item; totals: ItemTotals; movements: Movement[] };

export default function ProductScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const itemId = id;
  const { dataVersion } = useSync();
  const [data, setData] = useState<Data | null>(null);

  // dataVersion: reload when a sync brings in changes from the cloud.
  const refresh = useCallback(() => {
    Promise.all([getItem(db, itemId), getItemTotals(db, itemId), listMovements(db, itemId)]).then(
      ([item, totals, movements]) => {
        if (item) {
          setData({ item, totals, movements });
        } else if (router.canGoBack()) {
          router.back(); // deleted (possibly on another device)
        }
      }
    );
  }, [db, itemId, dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(refresh);

  if (!data) {
    return <ThemedView style={styles.container} />;
  }
  const { item, totals, movements } = data;
  const low = isLowStock(item);
  const avgPrice = totals.pricedUnits > 0 ? totals.purchaseValue / totals.pricedUnits : null;

  const addMovement = (type: MovementType) =>
    router.push({ pathname: '/movement', params: { itemId: item.id, type } });

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: item.name,
          headerRight: () => (
            <Pressable
              onPress={() => router.push({ pathname: '/item', params: { id: item.id } })}
              hitSlop={12}>
              <ThemedText style={{ color: theme.tint, fontWeight: 600 }}>Edit</ThemedText>
            </Pressable>
          ),
        }}
      />

      <FlatList
        data={movements}
        keyExtractor={(m) => m.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.four }]}
        ListHeaderComponent={
          <View style={styles.header}>
            {(item.sku !== '' || item.notes !== '') && (
              <View>
                {item.sku !== '' && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {item.sku}
                  </ThemedText>
                )}
                {item.notes !== '' && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {item.notes}
                  </ThemedText>
                )}
              </View>
            )}

            <View style={styles.stats}>
              <Stat label="In" value={totals.totalIn} />
              <Stat label="Out" value={totals.totalOut} />
              <Stat label={item.quantity === 0 ? 'Out of stock' : low ? 'Left · low' : 'Left'} value={item.quantity} warn={low} />
            </View>

            {avgPrice !== null && (
              <ThemedText type="small" themeColor="textSecondary">
                Avg. purchase price {formatMoney(avgPrice)}/unit · Total bought {formatMoney(totals.purchaseValue)}
              </ThemedText>
            )}

            <View style={styles.actions}>
              <ActionButton label="+ Stock in" onPress={() => addMovement('in')} />
              <ActionButton label="− Stock out" onPress={() => addMovement('out')} disabled={item.quantity === 0} />
            </View>

            <ThemedText type="smallBold" style={styles.sectionTitle}>
              History
            </ThemedText>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              No entries yet. Tap “Stock in” when a delivery arrives.
            </ThemedText>
          </View>
        }
        renderItem={({ item: m }) => <MovementRow movement={m} />}
      />
    </ThemedView>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: warn ? theme.warningBackground : theme.backgroundElement }]}>
      <ThemedText type="subtitle" style={warn && { color: theme.warning }}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

function ActionButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: theme.tint, opacity: disabled ? 0.35 : pressed ? 0.8 : 1 },
      ]}>
      <ThemedText style={{ color: theme.onTint, fontWeight: 600 }}>{label}</ThemedText>
    </Pressable>
  );
}

function MovementRow({ movement: m }: { movement: Movement }) {
  const theme = useTheme();
  const isIn = m.type === 'in';

  const details = isIn
    ? [
        m.unitPrice != null ? `${formatMoney(m.unitPrice)}/unit · ${formatMoney(m.unitPrice * m.quantity)}` : 'No price',
        m.party,
      ]
    : [m.party, m.city];
  const subtitle = [...details, m.notes].filter((s) => s !== '').join(' · ');

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/movement', params: { itemId: m.itemId, id: m.id } })}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <ThemedText
        type="smallBold"
        style={[
          styles.badge,
          isIn
            ? { color: theme.success, backgroundColor: theme.successBackground }
            : { color: theme.warning, backgroundColor: theme.warningBackground },
        ]}>
        {isIn ? `+${m.quantity}` : `−${m.quantity}`}
      </ThemedText>
      <View style={styles.rowText}>
        <ThemedText type="small">
          {formatDate(m.date)} · {isIn ? 'Inbound' : 'Outbound'}
        </ThemedText>
        {subtitle !== '' && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {subtitle}
          </ThemedText>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  header: {
    gap: Spacing.three,
  },
  stats: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  stat: {
    flex: 1,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: Spacing.three,
  },
  sectionTitle: {
    marginTop: Spacing.two,
  },
  empty: {
    paddingVertical: Spacing.four,
  },
  center: {
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: 12,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  badge: {
    minWidth: 52,
    textAlign: 'center',
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
    overflow: 'hidden',
    fontVariant: ['tabular-nums'],
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
});
