import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Handing a file to the iOS share sheet.
 *
 * **This is the one place data leaves the app in plaintext, and it is meant
 * to.** Everything at rest is encrypted under a key that never leaves the
 * device (`services/vault.ts`); a CSV is not. That is the point of an export —
 * it is for you to read — but it means the moment you choose "Save to Files" or
 * "Mail", the guarantee the rest of the app makes stops applying to that copy.
 * The UI says so before it offers the button.
 *
 * It is still not a network request. The app opens the share sheet; iOS does
 * whatever you pick. Nothing here knows about a server and nothing here can
 * send anything anywhere on its own.
 *
 * Files go to the **cache** directory, not documents: an export is a
 * disposable copy, and cache is the one iOS is free to reclaim. Leaving
 * plaintext CSVs accumulating in a backed-up documents directory would quietly
 * undo the encryption.
 */

export type ExportOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: 'unavailable' | 'failed'; readonly detail?: string };

export async function shareCsv(filename: string, contents: string): Promise<ExportOutcome> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, reason: 'unavailable' };
    }

    const file = new File(Paths.cache, filename);
    // Overwrite rather than fail: exporting twice in a minute produces the same
    // filename, and a stale copy is worse than no copy.
    if (file.exists) file.delete();
    file.create();
    file.write(contents);

    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
      dialogTitle: filename,
    });

    return { ok: true };
  } catch (error) {
    // The share sheet being dismissed is not an error worth reporting, but it
    // is indistinguishable from a real one here, so both are reported quietly.
    return { ok: false, reason: 'failed', detail: error instanceof Error ? error.message : undefined };
  }
}
