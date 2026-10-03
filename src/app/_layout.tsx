import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { migrateDbIfNeeded } from '@/db/inventory';
import { AuthProvider, useAuth } from '@/providers/auth-provider';
import { SyncProvider } from '@/providers/sync-provider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <SQLiteProvider databaseName="inventory.db" onInit={migrateDbIfNeeded}>
        <AuthProvider>
          <SyncProvider>
            <RootStack />
          </SyncProvider>
        </AuthProvider>
      </SQLiteProvider>
      <AnimatedSplashOverlay />
    </ThemeProvider>
  );
}

function RootStack() {
  const { session, loading } = useAuth();
  if (loading) return null; // splash overlay is still showing

  const signedIn = session !== null;
  return (
    <Stack>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" options={{ title: 'Inventory' }} />
        <Stack.Screen name="product" options={{ title: '' }} />
        <Stack.Screen name="item" options={{ presentation: 'modal' }} />
        <Stack.Screen name="movement" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
