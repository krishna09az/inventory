import 'expo-sqlite/localStorage/install';

import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** False until `.env.local` has the project's URL and publishable key (see README). */
export const supabaseConfigured = Boolean(url && key);

// Placeholders keep the client constructible before setup; the login screen shows
// a setup message instead of letting anyone sign in.
export const supabase = createClient(url || 'https://not-configured.invalid', key || 'not-configured', {
  auth: {
    // The session (login) is persisted in expo-sqlite's localStorage.
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    // On the website, email confirmation links land on the app with the session in the URL.
    detectSessionInUrl: Platform.OS === 'web',
  },
});

// Only refresh the session token while the app is in the foreground.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
