import { useCallback, useRef, useState } from 'react';

import { CHECK_TITLES, CHECKS, type CheckResult } from '@/services/diagnostics';
import type { Settings } from '@/services/settings';

/**
 * Running the checks, one after another, and showing each as it lands.
 *
 * **In sequence rather than all at once**, which is the opposite of what the
 * shape of the problem suggests. Four independent requests would obviously go
 * faster in parallel, and going faster is not what this screen is for: a person
 * presses the button because something is wrong, and four spinners resolving in
 * an order decided by the network is harder to read than four lines filling in
 * top to bottom. It also keeps a phone on a bad connection from opening four
 * sockets to prove it has none.
 *
 * Results are held here and nowhere else. Nothing is written to storage and
 * nothing is logged — they name buckets and quote services, and `console` output
 * is swept into a sysdiagnose and leaves the sandbox. Leaving the screen throws
 * them away, which is the intended lifetime.
 */

export interface UseDiagnostics {
  /** What has come back so far, in the order the checks are declared. */
  readonly results: readonly CheckResult[];
  /** The title of the check currently in flight, or null. */
  readonly running: string | null;
  /** True once a full run has finished, so "nothing yet" reads differently from "all off". */
  readonly ran: boolean;
  readonly run: () => void;
}

export function useDiagnostics(settings: Settings): UseDiagnostics {
  const [results, setResults] = useState<readonly CheckResult[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [ran, setRan] = useState(false);

  // One run at a time. Two overlapping runs would interleave their results into
  // the same list and each would write the other's out — the same guard
  // `useBackup` and `usePlanSync` both take.
  const busy = useRef(false);

  const run = useCallback(() => {
    if (busy.current) return;
    busy.current = true;

    void (async () => {
      setResults([]);
      setRan(false);
      try {
        const found: CheckResult[] = [];
        for (const check of CHECKS) {
          // Named before the request rather than after it, so the line being
          // waited on is the one on screen — a check that hangs is exactly the
          // case where knowing which one it is matters most.
          setRunning(CHECK_TITLES[check.id]);
          const result = await check.run(settings);
          found.push(result);
          setResults([...found]);
        }
        setRan(true);
      } finally {
        busy.current = false;
        setRunning(null);
      }
    })();
  }, [settings]);

  return { results, running, ran, run };
}
