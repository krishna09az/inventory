import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FormField } from '@/components/form-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase, supabaseConfigured } from '@/lib/supabase';

type Mode = 'signIn' | 'signUp';

export default function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setInfo(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signIn') {
        const { error } = await supabase.auth.signInWithPassword({ email: trimmedEmail, password });
        if (error) setError(error.message);
        // On success the auth provider receives the session and the app switches screens.
      } else {
        const { data, error } = await supabase.auth.signUp({ email: trimmedEmail, password });
        if (error) {
          setError(error.message);
        } else if (!data.session) {
          // Email confirmation is enabled in the Supabase project.
          setInfo('Account created. Open the confirmation email we sent, then come back and sign in.');
          setMode('signIn');
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.six }]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.heading}>
          <ThemedText type="subtitle">Inventory</ThemedText>
          <ThemedText themeColor="textSecondary">
            {mode === 'signIn' ? 'Sign in to see your stock.' : 'Create an account to back up your stock.'}
          </ThemedText>
        </View>

        {!supabaseConfigured ? (
          <ThemedText style={{ color: theme.danger }}>
            Supabase isn’t set up yet. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to
            .env.local (see README), then restart the dev server.
          </ThemedText>
        ) : (
          <>
            <FormField
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
            />
            <FormField
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder={mode === 'signUp' ? 'At least 6 characters' : ''}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
              textContentType={mode === 'signIn' ? 'password' : 'newPassword'}
              onSubmitEditing={submit}
            />

            {error && (
              <ThemedText type="small" style={{ color: theme.danger }}>
                {error}
              </ThemedText>
            )}
            {info && (
              <ThemedText type="small" style={{ color: theme.success }}>
                {info}
              </ThemedText>
            )}

            <Pressable
              onPress={submit}
              disabled={busy}
              style={({ pressed }) => [styles.button, { backgroundColor: theme.tint, opacity: pressed || busy ? 0.8 : 1 }]}>
              {busy ? (
                <ActivityIndicator color={theme.onTint} />
              ) : (
                <ThemedText style={{ color: theme.onTint, fontWeight: 600 }}>
                  {mode === 'signIn' ? 'Sign in' : 'Create account'}
                </ThemedText>
              )}
            </Pressable>

            <Pressable
              onPress={() => {
                setMode(mode === 'signIn' ? 'signUp' : 'signIn');
                setError(null);
                setInfo(null);
              }}
              style={({ pressed }) => [styles.button, { opacity: pressed ? 0.6 : 1 }]}>
              <ThemedText style={{ color: theme.tint }}>
                {mode === 'signIn' ? 'New here? Create an account' : 'Already have an account? Sign in'}
              </ThemedText>
            </Pressable>
          </>
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
    maxWidth: 480,
    alignSelf: 'center',
  },
  heading: {
    gap: Spacing.one,
    marginBottom: Spacing.three,
  },
  button: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: Spacing.three,
  },
});
