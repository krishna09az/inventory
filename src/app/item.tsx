import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { FormField } from '@/components/form-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { createItem, deleteItem, getItem, updateItem, type Item } from '@/db/inventory';
import { useTheme } from '@/hooks/use-theme';
import { parseCount, parsePrice, todayIso } from '@/utils/format';

export default function ItemScreen() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const itemId = id || undefined;
  const [item, setItem] = useState<Item | null | undefined>(itemId === undefined ? null : undefined);

  useEffect(() => {
    if (itemId !== undefined) {
      getItem(db, itemId).then(setItem);
    }
  }, [db, itemId]);

  // undefined = still loading an existing item
  if (item === undefined) {
    return <ThemedView style={styles.container} />;
  }
  return <ItemForm item={item} />;
}

function ItemForm({ item }: { item: Item | null }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [name, setName] = useState(item?.name ?? '');
  const [sku, setSku] = useState(item?.sku ?? '');
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [lowStockAt, setLowStockAt] = useState(String(item?.lowStockAt ?? 5));
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const low = parseCount(lowStockAt);
    if (name.trim() === '') {
      setError('Give the item a name.');
      return;
    }
    if (low === null) {
      setError('Low-stock level must be a whole number, 0 or more.');
      return;
    }
    const input = { name: name.trim(), sku: sku.trim(), lowStockAt: low, notes: notes.trim() };
    if (item) {
      await updateItem(db, item.id, input);
    } else {
      const qty = quantity.trim() === '' ? 0 : parseCount(quantity);
      const price = parsePrice(unitPrice);
      if (qty === null) {
        setError('Opening quantity must be a whole number, 0 or more.');
        return;
      }
      if (price === null) {
        setError('Price must be a number, e.g. 120 or 99.50.');
        return;
      }
      const opening =
        qty > 0
          ? { quantity: qty, unitPrice: price ?? null, party: '', city: '', date: todayIso(), notes: '' }
          : undefined;
      await createItem(db, input, opening);
    }
    router.back();
  };

  const remove = () => {
    if (!item) return;
    const doDelete = async () => {
      await deleteItem(db, item.id);
      router.dismissTo('/');
    };
    const message = `Delete “${item.name}” and its full stock history? This can't be undone.`;
    if (Platform.OS === 'web') {
      if (window.confirm(message)) doDelete();
      return;
    }
    Alert.alert('Delete item', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: doDelete },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen
        options={{
          title: item ? 'Edit item' : 'New item',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <ThemedText style={{ color: theme.tint }}>Cancel</ThemedText>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={save} hitSlop={12}>
              <ThemedText style={{ color: theme.tint, fontWeight: 600 }}>Save</ThemedText>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <FormField label="Name" value={name} onChangeText={setName} placeholder="e.g. Brass door handle" autoFocus={!item} />
        <FormField label="SKU / code" value={sku} onChangeText={setSku} placeholder="Optional" autoCapitalize="characters" />
        {!item && (
          <View style={styles.pair}>
            <FormField
              label="Opening quantity"
              value={quantity}
              onChangeText={setQuantity}
              placeholder="0"
              keyboardType="number-pad"
            />
            <FormField
              label="Price per unit (₹)"
              value={unitPrice}
              onChangeText={setUnitPrice}
              placeholder="Optional"
              keyboardType="decimal-pad"
            />
          </View>
        )}
        <FormField label="Low-stock alert at" value={lowStockAt} onChangeText={setLowStockAt} keyboardType="number-pad" />
        <FormField
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          placeholder="Location, supplier, etc."
          multiline
          style={styles.notes}
        />
        {item && (
          <ThemedText type="small" themeColor="textSecondary">
            Stock changes through “Stock in” and “Stock out” on the item page.
          </ThemedText>
        )}

        {error && (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {error}
          </ThemedText>
        )}

        <Pressable
          onPress={save}
          style={({ pressed }) => [styles.button, { backgroundColor: theme.tint, opacity: pressed ? 0.8 : 1 }]}>
          <ThemedText style={{ color: theme.onTint, fontWeight: 600 }}>{item ? 'Save changes' : 'Add item'}</ThemedText>
        </Pressable>

        {item && (
          <Pressable onPress={remove} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.6 : 1 }]}>
            <ThemedText style={{ color: theme.danger, fontWeight: 600 }}>Delete item</ThemedText>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  pair: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  notes: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  button: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: Spacing.three,
  },
});
