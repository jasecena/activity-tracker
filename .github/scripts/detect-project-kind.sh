#!/usr/bin/env bash
#
# Classifies the repository so the release workflow knows which pre-build steps
# to run. Emits GitHub Actions `key=value` output lines on stdout.
#
# Outputs:
#   kind            native | expo | react-native | flutter
#   uses_node       whether to set up Node and run npm ci
#   uses_cocoapods  whether to run pod install and cache Pods
#   needs_prebuild  whether the ios/ directory must be generated
#
# Keeping this in a script rather than inline YAML means it can be run and
# tested locally, and that the workflow stays readable.

set -euo pipefail

kind="native"
uses_node="false"
uses_cocoapods="false"
needs_prebuild="false"

if [[ -f "pubspec.yaml" ]]; then
  kind="flutter"
  uses_cocoapods="true"
  needs_prebuild="true"
elif [[ -f "package.json" ]]; then
  uses_node="true"
  # Expo manages the native project as a build artifact; plain React Native
  # commits ios/ to source control. The distinction decides whether we generate
  # the project or expect to find it.
  if grep -qE '"(expo)"[[:space:]]*:' package.json; then
    kind="expo"
  elif grep -qE '"react-native"[[:space:]]*:' package.json; then
    kind="react-native"
  else
    kind="native"
  fi
  uses_cocoapods="true"
  # Only generate when it is genuinely absent — a committed ios/ directory
  # (with custom native code in it) must never be clobbered by a prebuild.
  if [[ "$kind" == "expo" && ! -d "ios" ]]; then
    needs_prebuild="true"
  fi
fi

if [[ "$kind" == "native" ]]; then
  [[ -f "ios/Podfile" || -f "Podfile" ]] && uses_cocoapods="true"
fi

{
  echo "kind=${kind}"
  echo "uses_node=${uses_node}"
  echo "uses_cocoapods=${uses_cocoapods}"
  echo "needs_prebuild=${needs_prebuild}"
} | tee /dev/stderr
