import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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
 *
 * `GestureHandlerRootView` has to be the outermost view rather than wrapped
 * around the one screen that uses a gesture: the library installs its touch
 * handling at the root of the tree, and a gesture inside a subtree it does not
 * own simply never fires. It exists for the swipe-to-delete on the Notes tab —
 * see `AGENTS.md` on why that is a library rather than a `PanResponder`.
 */
export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <TabShell />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
