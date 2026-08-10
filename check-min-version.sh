#!/usr/bin/env bash
# Print the minimum OpenShift version this plugin declares, for AutoShift to gate on.
#
# ACM policy templates can only look up Kubernetes resources — they cannot read this package.json,
# and the file only reaches a cluster inside the image, which is circular. So AutoShift carries the
# same floor in config.autoshiftConsole.minOpenShiftVersion and CI asserts the two agree.
set -euo pipefail

RANGE=$(node -e "process.stdout.write(require('./package.json').consolePlugin.dependencies['@console/pluginAPI'])")
# ">=4.22.0-0" -> "4.22.0-0"; a wildcard means no floor is claimed.
FLOOR=$(printf '%s' "$RANGE" | sed -nE 's/^>=[[:space:]]*([0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?).*/\1/p')

if [ -z "$FLOOR" ]; then
  echo "pluginAPI range '$RANGE' declares no lower bound — AutoShift cannot gate on it." >&2
  exit 1
fi

echo "$FLOOR"
