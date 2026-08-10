import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TabShell } from '@/shell/TabShell';

/**
 * Nothing runs before the shell.
 *
 * There was a one-off pass here that deleted coordinates two fixed bugs had put
 * hundreds of kilometres out to sea, and it held the app behind it so no store
 * could be read half-cleaned. It has run, both bugs are fixed at the source, and
 * a fresh install cannot produce what it repaired — so the pass, its marker key
 * and the launch gate have gone together, which is what the note on it always
 * asked for.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <TabShell />
    </SafeAreaProvider>
  );
}
