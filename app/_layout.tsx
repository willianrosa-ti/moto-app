import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import NativeAppSetup from '@/components/NativeAppSetup';

export default function Layout() {
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
