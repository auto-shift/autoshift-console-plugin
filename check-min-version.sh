#!/usr/bin/env bash
# Print the minimum OpenShift version a target declares, for AutoShift to gate on.
#
# ACM policy templates can only look up Kubernetes resources — they cannot read ocp-targets.json,
# and the file only reaches a cluster inside the image, which is circular. So AutoShift carries the
# same floor in config.autoshiftConsole.minOpenShiftVersion and CI asserts the two agree.
#
# Usage: ./check-min-version.sh <ocp-minor>     # e.g. ./check-min-version.sh 4.22
set -euo pipefail

TARGET="${1:-${OCP_TARGET:-}}"
if [ -z "$TARGET" ]; then
  echo "usage: $0 <ocp-minor>   (e.g. 4.22)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RANGE=$(node -e "
  const { targets } = require('$ROOT/ocp-targets.json');
  const spec = targets['$TARGET'];
  if (!spec) {
    console.error(\"unknown target '$TARGET'; declared: \" + Object.keys(targets).join(', '));
    process.exit(1);
  }
  process.stdout.write(spec.pluginAPI);
")

# ">=4.22.0-0" -> "4.22.0-0"; a wildcard means no floor is claimed.
FLOOR=$(printf '%s' "$RANGE" | sed -nE 's/^>=[[:space:]]*([0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?).*/\1/p')

if [ -z "$FLOOR" ]; then
  echo "pluginAPI range '$RANGE' declares no lower bound — AutoShift cannot gate on it." >&2
  exit 1
fi

echo "$FLOOR"
