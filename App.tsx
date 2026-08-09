import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { removeImpossiblePositions } from '@/services/cleanup';
import { TabShell } from '@/shell/TabShell';
import { colors } from '@/theme/tokens';

/**
 * The one-off cleanup runs **before the shell mounts**, and that is the whole
 * reason it is here rather than inside a hook.
 *
 * Every store is read on mount by the hook that owns it — fixes, places, the
 * media index — all at once and in no particular order. A cleanup running
 * alongside them would race every one: a screen could render a position it was
 * in the middle of deleting, and a hook that had already read could write its
 * copy back over the cleaned one. Holding the shell for one pass costs a frame
 * on a single launch and removes the question entirely.
 *
 * Delete this together with `services/cleanup.ts` — see the note there.
 */
export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void removeImpossiblePositions()
      .catch(() => undefined)
      .then(() => setReady(true));
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {ready ? <TabShell /> : <View style={{ flex: 1, backgroundColor: colors.background }} />}
    </SafeAreaProvider>
  );
}
