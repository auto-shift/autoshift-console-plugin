#!/usr/bin/env bash
# Run a root toolchain binary with an OpenShift target directory as the working directory.
#
# ConsoleRemotePlugin calls read-pkg with no cwd, so it reads package.json from the process
# working directory and derives the bundle's shared-module set from the dependencies declared
# there. It also globs "$cwd/node_modules/@patternfly/react-styles/**/*.css" to alias those files
# away, which is what stops the plugin bundling a second copy of PatternFly's CSS. Both need cwd
# to be targets/<minor>, which is why the build cannot simply run from the repo root.
#
# The binary and the shared webpack/jest config stay at the root, where the toolchain is
# installed; only the module-federation contract lives per target.
#
# Usage: ./scripts/ocp.sh <bin> [args...]        # OCP_TARGET selects the target
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Defaults to the newest declared target rather than a hardcoded minor, so adding a release to
# ocp-targets.json moves the default with it.
if [ -z "${OCP_TARGET:-}" ]; then
  OCP_TARGET=$(node -e "
    const t = Object.keys(require('$ROOT/ocp-targets.json').targets);
    process.stdout.write(t[t.length - 1]);
  ")
fi

DIR="$ROOT/targets/$OCP_TARGET"
if [ ! -d "$DIR" ]; then
  KNOWN=$(node -e "process.stdout.write(Object.keys(require('$ROOT/ocp-targets.json').targets).join(', '))")
  echo "unknown OCP_TARGET '$OCP_TARGET'; declared targets: $KNOWN" >&2
  exit 1
fi

# The contract tree is a separate install from the root toolchain, so it is genuinely easy to
# forget. Saying so beats a resolution error from deep inside webpack.
if [ ! -d "$DIR/node_modules" ]; then
  echo "targets/$OCP_TARGET has no node_modules — run:" >&2
  echo "  (cd targets/$OCP_TARGET && yarn install --immutable)" >&2
  exit 1
fi

BIN="$1"
shift
export OCP_TARGET

# The SDK's DynamicModuleImportPlugin appends its loader to a module's loader list as a bare
# specifier, after webpack has finished resolving loaders — so `resolveLoader` never sees it and
# loader-runner ends up calling plain require() from wherever webpack itself is installed, which
# is the root toolchain tree. NODE_PATH is what lets that require reach the target's SDK. Without
# it 4.21 and 4.22 fail with "Cannot find module .../dynamic-module-import-loader"; 4.20's older
# SDK does not use the loader and builds either way, which is exactly the kind of difference that
# would otherwise be found only on whichever target was tried second.
export NODE_PATH="$DIR/node_modules"

cd "$DIR"
exec "$ROOT/node_modules/.bin/$BIN" "$@"
