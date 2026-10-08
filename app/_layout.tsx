import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import NativeAppSetup from '../components/NativeAppSetup';
import ChatMotorista from '../components/ChatMotorista';
import AvisoFlutuante from '../components/AvisoFlutuante';
import RadioProvider from '../components/RadioProvider';

export default function Layout() {
  return (
    <SafeAreaProvider>
      <RadioProvider>
      <NativeAppSetup />
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
      <ChatMotorista />
      <AvisoFlutuante />
      </RadioProvider>
    </SafeAreaProvider>
  );
}
