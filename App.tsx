import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TabShell } from '@/shell/TabShell';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <TabShell />
    </SafeAreaProvider>
  );
}
