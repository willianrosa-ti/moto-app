import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import NativeAppSetup from '@/components/NativeAppSetup';
import { registrarServiceWorkerWeb } from '@/utils/webNotifications';

export default function Layout() {
  useEffect(() => {
    registrarServiceWorkerWeb().catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <NativeAppSetup />
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
    </SafeAreaProvider>
  );
}
