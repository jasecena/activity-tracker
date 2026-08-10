import ExpoModulesCore

/**
 Whether a file or directory is copied into an iCloud or iTunes backup.

 One resource key — `NSURLIsExcludedFromBackupKey` — and no JavaScript API
 anywhere in `expo-file-system@57` reaches it. It is the only thing standing
 between `Documents/media` and a backup, now that captures are ordinary files
 rather than a sealed container: the vault key is `THIS_DEVICE_ONLY`, so
 everything it covers restores as unreadable ciphertext, and media used to get
 that guarantee by being sealed under the same key. It no longer is, so it
 needs the flag instead.

 Set on the **directory**, which excludes everything beneath it. That matters
 more than it sounds: a per-file call would have to be made on every capture and
 would silently miss any file written by a path that forgot, whereas the
 directory carries the flag for files that do not exist yet.

 **Read before write, so calling it repeatedly is free.** The caller applies
 this from `ensureDirectory`, which runs on every write, and that is deliberate
 — it is also the migration. A phone that stored captures under an older build
 has a directory with no flag on it, and there is no launch-time step to add
 one; the next write heals it, and the read makes the other ten thousand calls
 a single `getattr`.
 */
public class FileBackupModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FileBackup")

    /**
     Returns whether the flag is now in the requested state.

     `false` means the URL was unusable or the filesystem refused, which the
     caller treats as "not excluded" rather than as an error — see the module's
     TypeScript face for why this cannot throw.

     Synchronous on purpose. The caller is `ensureDirectory`, which is
     synchronous and runs immediately before bytes are written; an `await` here
     would open a suspension point between creating the directory and flagging
     it, which is precisely the window this is meant to close.
     */
    Function("setExcluded") { (uri: String, excluded: Bool) -> Bool in
      guard let url = URL(string: uri), url.isFileURL else { return false }

      do {
        let current = try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup
        if current == excluded { return true }

        var target = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = excluded
        try target.setResourceValues(values)
        return true
      } catch {
        // Most often: the path does not exist yet. The caller creates the
        // directory first, so this is a real failure rather than a race — but
        // it is not one worth losing a capture over.
        return false
      }
    }
  }
}
