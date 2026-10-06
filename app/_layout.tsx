import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import NativeAppSetup from '../components/NativeAppSetup';
import ChatMotorista from '../components/ChatMotorista';

export default function Layout() {
  return (
    <SafeAreaProvider>
      <NativeAppSetup />
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
      <ChatMotorista />
    </SafeAreaProvider>
  );
}
