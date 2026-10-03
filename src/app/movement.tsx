import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { FormField } from '@/components/form-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import {
  createMovement,
  deleteMovement,
  getItem,
  getMovement,
  stockExcluding,
  updateMovement,
  type Item,
  type Movement,
  type MovementType,
} from '@/db/inventory';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney, inputToIso, isoToInput, parseCount, parsePrice, todayIso } from '@/utils/format';

type Params = { itemId: string; type?: MovementType; id?: string };

export default function MovementScreen() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<Params>();
  const itemId = params.itemId;
  const movementId = params.id || undefined;
  const [loaded, setLoaded] = useState<{ item: Item; movement: Movement | null } | null>(null);

  useEffect(() => {
    Promise.all([
      getItem(db, itemId),
      movementId === undefined ? Promise.resolve(null) : getMovement(db, movementId),
    ]).then(([item, movement]) => {
      if (item) setLoaded({ item, movement });
    });
  }, [db, itemId, movementId]);

  if (!loaded) {
    return <ThemedView style={styles.container} />;
  }
  const type = loaded.movement?.type ?? (params.type === 'out' ? 'out' : 'in');
  return <MovementForm item={loaded.item} movement={loaded.movement} type={type} />;
}

function MovementForm({ item, movement, type }: { item: Item; movement: Movement | null; type: MovementType }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const isIn = type === 'in';
  const [quantity, setQuantity] = useState(movement ? String(movement.quantity) : '');
  const [unitPrice, setUnitPrice] = useState(movement?.unitPrice != null ? String(movement.unitPrice) : '');
  const [date, setDate] = useState(isoToInput(movement?.date ?? todayIso()));
  const [party, setParty] = useState(movement?.party ?? '');
  const [city, setCity] = useState(movement?.city ?? '');
  const [notes, setNotes] = useState(movement?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  // Stock available for an outbound entry (this entry's own units count as available when editing).
  const available = item.quantity + (movement && !isIn ? movement.quantity : 0);
  const qtyValue = parseCount(quantity);
  const priceValue = parsePrice(unitPrice);
  const lineTotal = isIn && qtyValue && priceValue ? qtyValue * priceValue : null;

  const save = async () => {
    const isoDate = inputToIso(date);
    if (qtyValue === null || qtyValue === 0) {
      setError('Quantity must be a whole number above 0.');
      return;
    }
    if (isIn && priceValue === null) {
      setError('Price must be a number, e.g. 120 or 99.50.');
      return;
    }
    if (!isoDate) {
      setError('Enter the date as DD/MM/YYYY, e.g. 30/09/2026.');
      return;
    }
    const base = await stockExcluding(db, item.id, movement?.id);
    const after = base + (isIn ? qtyValue : -qtyValue);
    if (after < 0) {
      setError(
        isIn
          ? `More units have already gone out than this would leave. Quantity must be at least ${-base}.`
          : `Only ${base} in stock — you can't send out ${qtyValue}.`
      );
      return;
    }
    const input = {
      quantity: qtyValue,
      unitPrice: isIn ? (priceValue ?? null) : null,
      party: party.trim(),
      city: isIn ? '' : city.trim(),
      date: isoDate,
      notes: notes.trim(),
    };
    if (movement) {
      await updateMovement(db, movement.id, input);
    } else {
      await createMovement(db, item.id, type, input);
    }
    router.back();
  };

  const remove = async () => {
    if (!movement) return;
    if (isIn && (await stockExcluding(db, item.id, movement.id)) < 0) {
      setError("Can't delete: those units have already gone out. Edit or delete the outbound entries first.");
      return;
    }
    const doDelete = async () => {
      await deleteMovement(db, movement.id);
      router.back();
    };
    const message = `Delete this ${isIn ? 'inbound' : 'outbound'} entry of ${movement.quantity} units?`;
    if (Platform.OS === 'web') {
      if (window.confirm(message)) doDelete();
      return;
    }
    Alert.alert('Delete entry', message, [
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
          title: isIn ? 'Stock in' : 'Stock out',
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
        <View>
          <ThemedText type="smallBold">{item.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {isIn ? `${item.quantity} in stock now` : `${available} available to send out`}
          </ThemedText>
        </View>

        <View style={styles.pair}>
          <FormField
            label="Quantity"
            value={quantity}
            onChangeText={setQuantity}
            placeholder="0"
            keyboardType="number-pad"
            autoFocus={!movement}
          />
          {isIn ? (
            <FormField
              label="Price per unit (₹)"
              value={unitPrice}
              onChangeText={setUnitPrice}
              placeholder="Optional"
              keyboardType="decimal-pad"
            />
          ) : (
            <FormField label="Date (DD/MM/YYYY)" value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" />
          )}
        </View>
        {lineTotal !== null && (
          <ThemedText type="small" themeColor="textSecondary">
            Total {formatMoney(lineTotal)}
          </ThemedText>
        )}

        {isIn ? (
          <>
            <FormField label="Date (DD/MM/YYYY)" value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" />
            <FormField label="Supplier" value={party} onChangeText={setParty} placeholder="Optional" autoCapitalize="words" />
          </>
        ) : (
          <View style={styles.pair}>
            <FormField label="Client name" value={party} onChangeText={setParty} placeholder="e.g. Mr. K" autoCapitalize="words" />
            <FormField label="City" value={city} onChangeText={setCity} placeholder="e.g. Bareilly" autoCapitalize="words" />
          </View>
        )}

        <FormField label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" multiline style={styles.notes} />

        {error && (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {error}
          </ThemedText>
        )}

        <Pressable
          onPress={save}
          style={({ pressed }) => [styles.button, { backgroundColor: theme.tint, opacity: pressed ? 0.8 : 1 }]}>
          <ThemedText style={{ color: theme.onTint, fontWeight: 600 }}>
            {movement ? 'Save changes' : isIn ? 'Add stock' : 'Send out'}
          </ThemedText>
        </Pressable>

        {movement && (
          <Pressable onPress={remove} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.6 : 1 }]}>
            <ThemedText style={{ color: theme.danger, fontWeight: 600 }}>Delete entry</ThemedText>
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
    minHeight: 72,
    textAlignVertical: 'top',
  },
  button: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: Spacing.three,
  },
});
