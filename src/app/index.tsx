import { router, Stack, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { isLowStock, listItems, type Item } from '@/db/inventory';
import { useTheme } from '@/hooks/use-theme';

export default function InventoryScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState('');
  const [lowOnly, setLowOnly] = useState(false);

  const refresh = useCallback(() => {
    listItems(db).then(setItems);
  }, [db]);

  useFocusEffect(refresh);


  const q = query.trim().toLowerCase();
  const visible = items.filter(
    (item) =>
      (!lowOnly || isLowStock(item)) &&
      (q === '' || item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q))
  );
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
  const lowCount = items.filter(isLowStock).length;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.push('/item')} hitSlop={12}>
              <ThemedText style={{ color: theme.tint, fontWeight: 600 }}>Add</ThemedText>
            </Pressable>
          ),
        }}
      />

      <FlatList
        data={visible}
        keyExtractor={(item) => String(item.id)}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.four }]}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.stats}>
              <Stat label="Products" value={items.length} />
              <Stat label="Units" value={totalUnits} />
              <Pressable style={styles.statPressable} onPress={() => setLowOnly((v) => !v)}>
                <Stat label={lowOnly ? 'Low stock ✓' : 'Low stock'} value={lowCount} warn={lowOnly} />
              </Pressable>
            </View>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search name or SKU"
              placeholderTextColor={theme.textSecondary}
              clearButtonMode="while-editing"
              autoCorrect={false}
              style={[styles.search, { backgroundColor: theme.backgroundElement, color: theme.text }]}
            />
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <ThemedText type="smallBold">
              {items.length === 0 ? 'No items yet' : 'Nothing matches'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              {items.length === 0
                ? 'Tap “Add” to create your first inventory item.'
                : 'Try a different search or turn off the low-stock filter.'}
            </ThemedText>
          </View>
        }
        renderItem={({ item }) => <ItemRow item={item} />}
      />
    </ThemedView>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.stat,
        { backgroundColor: warn ? theme.warningBackground : theme.backgroundElement },
      ]}>
      <ThemedText type="subtitle" style={warn && { color: theme.warning }}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

function ItemRow({ item }: { item: Item }) {
  const theme = useTheme();
  const low = isLowStock(item);

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/product', params: { id: String(item.id) } })}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <View style={styles.rowText}>
        <ThemedText numberOfLines={1}>{item.name}</ThemedText>
        <View style={styles.rowMeta}>
          {item.sku !== '' && (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {item.sku}
            </ThemedText>
          )}
          {low && (
            <ThemedText
              type="smallBold"
              style={[styles.badge, { color: theme.warning, backgroundColor: theme.warningBackground }]}>
              {item.quantity === 0 ? 'Out of stock' : 'Low'}
            </ThemedText>
          )}
        </View>
      </View>

      <View style={styles.qtyBox}>
        <ThemedText type="smallBold" style={[styles.qty, low && { color: theme.warning }]}>
          {item.quantity}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          in stock
        </ThemedText>
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
    marginBottom: Spacing.two,
  },
  stats: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  statPressable: {
    flex: 1,
  },
  stat: {
    flex: 1,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  search: {
    fontSize: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    borderRadius: Spacing.three,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.six,
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
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  badge: {
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  qtyBox: {
    alignItems: 'flex-end',
  },
  qty: {
    fontSize: 18,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
  },
});
