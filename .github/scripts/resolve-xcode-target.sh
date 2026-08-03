#!/usr/bin/env bash
#
# Locates the Xcode workspace/project and the scheme to archive, so the release
# workflow does not need those names hard-coded. Emits GitHub Actions
# `key=value` output lines on stdout.
#
# Outputs:
#   workspace  path to the .xcworkspace, or empty
#   project    path to the .xcodeproj, used only when there is no workspace
#   scheme     the scheme to archive
#
# Env:
#   SCHEME_OVERRIDE  optional explicit scheme name

set -euo pipefail

workspace=""
project=""
app_project=""

# CocoaPods generates a workspace, and building the .xcodeproj directly would
# miss the Pods target — so a workspace always wins when one exists.
for dir in ios .; do
  [[ -d "$dir" ]] || continue
  found="$(find "$dir" -maxdepth 1 -name '*.xcworkspace' -not -name 'project.xcworkspace' | head -1)"
  if [[ -n "$found" ]]; then
    workspace="$found"
    break
  fi
done

for dir in ios .; do
  [[ -d "$dir" ]] || continue
  found="$(find "$dir" -maxdepth 1 -name '*.xcodeproj' -not -name 'Pods.xcodeproj' | head -1)"
  if [[ -n "$found" ]]; then
    app_project="$found"
    break
  fi
done

# `project` is only emitted when there is no workspace to build against;
# `app_project` is kept regardless, because it is the most reliable place to
# find the application's own scheme.
if [[ -z "$workspace" ]]; then
  project="$app_project"
fi

if [[ -z "$workspace" && -z "$project" ]]; then
  echo "::error::No .xcworkspace or .xcodeproj found. If this is an Expo or Flutter app, the prebuild step did not run or failed." >&2
  exit 1
fi

if [[ -n "$workspace" ]]; then
  list_args=(-workspace "$workspace")
else
  list_args=(-project "$project")
fi

schemes_json="$(xcodebuild -list -json "${list_args[@]}")"

# Read the scheme list with a loop rather than `mapfile`. `mapfile` is a bash 4
# builtin and macOS still ships bash 3.2 — frozen in 2007 over the GPLv3 licence
# change — so on a macOS runner it fails with "mapfile: command not found" and
# exit 127. This script only ever runs on macOS, which is why the Linux CI job
# cannot catch a regression here.
#
# The body uses `if` rather than `[[ ... ]] && ...` because under `set -e` a
# trailing false test would make the loop body return non-zero and abort.
schemes=()
while IFS= read -r line; do
  if [[ -n "$line" ]]; then
    schemes+=("$line")
  fi
done < <(printf '%s' "$schemes_json" | jq -r '(.workspace // .project).schemes[]')

if (( ${#schemes[@]} == 0 )); then
  echo "::error::No shared schemes found. In Xcode, mark the scheme as Shared and commit the resulting .xcscheme file." >&2
  exit 1
fi

if [[ -n "${SCHEME_OVERRIDE:-}" ]]; then
  scheme="$SCHEME_OVERRIDE"
  # Fail loudly on a typo rather than letting xcodebuild guess.
  if ! printf '%s\n' "${schemes[@]}" | grep -Fxq "$scheme"; then
    echo "::error::Scheme '${scheme}' not found. Available: ${schemes[*]}" >&2
    exit 1
  fi
else
  # Choosing "the first scheme that is not Pods-*" is wrong for any CocoaPods
  # project. A React Native workspace lists a scheme per dependency — around a
  # hundred of them — and xcodebuild returns them alphabetically, so that rule
  # picks something like `EXConstants`. Archiving a static library succeeds and
  # reports "ARCHIVE SUCCEEDED" while producing no .app at all, which then fails
  # much later and far less clearly.
  #
  # Two better signals, in order.
  scheme=""

  # 1. The application scheme is named after its container. Xcode names the
  #    scheme after the target, and `expo prebuild` names the project after the
  #    app, so ios/GentleTaskTimer.xcworkspace implies scheme GentleTaskTimer.
  container="${workspace:-$app_project}"
  if [[ -n "$container" ]]; then
    expected="$(basename "$container")"
    expected="${expected%.*}"
    for candidate in "${schemes[@]}"; do
      if [[ "$candidate" == "$expected" ]]; then
        scheme="$candidate"
        break
      fi
    done
  fi

  # 2. Otherwise ask the app's own .xcodeproj rather than the workspace. The
  #    project lists only the app's schemes; the workspace also lists every
  #    pod's.
  if [[ -z "$scheme" && -n "$app_project" ]]; then
    while IFS= read -r line; do
      if [[ -n "$line" && "$line" != Pods-* ]]; then
        scheme="$line"
        break
      fi
    done < <(xcodebuild -list -json -project "$app_project" 2>/dev/null \
               | jq -r '(.project // .workspace).schemes[]?' || true)
  fi

  if [[ -z "$scheme" ]]; then
    echo "::error::Could not identify the application scheme. Expected one named '${expected:-<unknown>}'. Available: ${schemes[*]}" >&2
    echo "::error::Set the 'scheme' workflow input to choose explicitly." >&2
    exit 1
  fi
fi

echo "Resolved workspace='${workspace}' project='${project}' scheme='${scheme}'" >&2
echo "Available schemes: ${schemes[*]}" >&2

echo "workspace=${workspace}"
echo "project=${project}"
echo "scheme=${scheme}"
