#!/usr/bin/env bash
# Point package.json at one OpenShift target from ocp-targets.json, then `yarn install && yarn build`.
#
# The build is otherwise identical across targets — only the shared-module versions and the declared
# pluginAPI range change, because those are what the console enforces at load time.
#
#
# Rewriting package.json can invalidate yarn.lock, so run `yarn install` afterwards. With a single
# target that is a no-op and the committed lockfile stands; see ocp-targets.json on what a second
# target costs.
#
# Usage: ./scripts/set-ocp-target.sh 4.22
set -euo pipefail

TARGET="${1:-}"
[ -n "$TARGET" ] || { echo "usage: $0 <ocp-minor>   (e.g. 4.22)" >&2; exit 1; }

node - "$TARGET" <<'NODE'
const fs = require('fs');
const target = process.argv[2];
const targets = JSON.parse(fs.readFileSync('ocp-targets.json', 'utf8')).targets;
const spec = targets[target];
if (!spec) {
  console.error(`unknown target '${target}'. known: ${Object.keys(targets).join(', ')}`);
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.devDependencies['@openshift-console/dynamic-plugin-sdk'] = spec.sdk;
pkg.devDependencies['@openshift-console/dynamic-plugin-sdk-webpack'] = spec.sdk;
for (const [dep, version] of Object.entries(spec.shared)) {
  pkg.devDependencies[dep] = version;
}
// The console skips a plugin whose range excludes it — cleanly, rather than the silent
// module-federation failure you get from loading an incompatible bundle.
pkg.consolePlugin.dependencies['@console/pluginAPI'] = spec.pluginAPI;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log(`  target      ${target}`);
console.log(`  sdk         ${spec.sdk}`);
console.log(`  pluginAPI   ${spec.pluginAPI}`);
for (const [d, v] of Object.entries(spec.shared)) console.log(`  ${d.padEnd(12)}${v}`);
NODE
