import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { migrateDbIfNeeded } from '@/db/inventory';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <SQLiteProvider databaseName="inventory.db" onInit={migrateDbIfNeeded}>
        <Stack>
          <Stack.Screen name="index" options={{ title: 'Inventory' }} />
          <Stack.Screen name="product" options={{ title: '' }} />
          <Stack.Screen name="item" options={{ presentation: 'modal' }} />
          <Stack.Screen name="movement" options={{ presentation: 'modal' }} />
        </Stack>
      </SQLiteProvider>
      <AnimatedSplashOverlay />
    </ThemeProvider>
  );
}
