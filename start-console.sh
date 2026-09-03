#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Which target to run the console for. Defaults to the newest in ocp-targets.json, matching
# scripts/ocp.sh, so `yarn start` and `yarn start-console` agree unless OCP_TARGET says otherwise.
if [ -z "${OCP_TARGET:-}" ]; then
  OCP_TARGET=$(node -e "
    const t = Object.keys(require('$ROOT/ocp-targets.json').targets);
    process.stdout.write(t[t.length - 1]);
  ")
fi

# Pinned to the OpenShift release being targeted, NOT :latest. :latest tracks master, which
# supplies a different React / react-router than any released console — so a plugin that is broken
# on a real cluster can still look perfectly fine locally. Testing a 4.20 build against a 4.22
# console is the same mistake by a smaller margin, which is why this follows the target.
CONSOLE_IMAGE=${CONSOLE_IMAGE:=$(node -e "
  const { targets } = require('$ROOT/ocp-targets.json');
  const spec = targets['$OCP_TARGET'];
  if (!spec) {
    console.error(\"unknown OCP_TARGET '$OCP_TARGET'; declared: \" + Object.keys(targets).join(', '));
    process.exit(1);
  }
  process.stdout.write(spec.consoleImage);
")}
CONSOLE_PORT=${CONSOLE_PORT:=9000}
CONSOLE_IMAGE_PLATFORM=${CONSOLE_IMAGE_PLATFORM:="linux/amd64"}

# Plugin metadata is declared in package.json
PLUGIN_NAME=${npm_package_consolePlugin_name}

echo "Starting local OpenShift console for target ${OCP_TARGET}..."

BRIDGE_USER_AUTH="disabled"
BRIDGE_K8S_MODE="off-cluster"
BRIDGE_K8S_AUTH="bearer-token"
BRIDGE_K8S_MODE_OFF_CLUSTER_SKIP_VERIFY_TLS=true
BRIDGE_K8S_MODE_OFF_CLUSTER_ENDPOINT=$(oc whoami --show-server)
# The monitoring operator is not always installed (e.g. for local OpenShift). Tolerate missing config maps.
set +e
BRIDGE_K8S_MODE_OFF_CLUSTER_THANOS=$(oc -n openshift-config-managed get configmap monitoring-shared-config -o jsonpath='{.data.thanosPublicURL}' 2>/dev/null)
BRIDGE_K8S_MODE_OFF_CLUSTER_ALERTMANAGER=$(oc -n openshift-config-managed get configmap monitoring-shared-config -o jsonpath='{.data.alertmanagerPublicURL}' 2>/dev/null)
set -e
BRIDGE_K8S_AUTH_BEARER_TOKEN=$(oc whoami --show-token 2>/dev/null)
BRIDGE_USER_SETTINGS_LOCATION="localstorage"
BRIDGE_I18N_NAMESPACES="plugin__${PLUGIN_NAME}"

# Don't fail if the cluster doesn't have gitops.
set +e
GITOPS_HOSTNAME=$(oc -n openshift-gitops get route cluster -o jsonpath='{.spec.host}' 2>/dev/null)
set -e
if [ -n "$GITOPS_HOSTNAME" ]; then
    BRIDGE_K8S_MODE_OFF_CLUSTER_GITOPS="https://$GITOPS_HOSTNAME"
fi

echo "API Server: $BRIDGE_K8S_MODE_OFF_CLUSTER_ENDPOINT"
echo "Console Image: $CONSOLE_IMAGE"
echo "Console URL: http://localhost:${CONSOLE_PORT}"
echo "Console Platform: $CONSOLE_IMAGE_PLATFORM"

# Prefer podman if installed. Otherwise, fall back to docker.
if [ -x "$(command -v podman)" ]; then
    if [ "$(uname -s)" = "Linux" ]; then
        # Use host networking on Linux since host.containers.internal is unreachable in some environments.
        BRIDGE_PLUGINS="${PLUGIN_NAME}=http://localhost:9001"
        podman run --pull always --platform $CONSOLE_IMAGE_PLATFORM --rm --network=host --env-file <(set | grep BRIDGE) $CONSOLE_IMAGE
    else
        BRIDGE_PLUGINS="${PLUGIN_NAME}=http://host.containers.internal:9001"
        podman run --pull always --platform $CONSOLE_IMAGE_PLATFORM --rm -p "$CONSOLE_PORT":9000 --env-file <(set | grep BRIDGE) $CONSOLE_IMAGE
    fi
else
    BRIDGE_PLUGINS="${PLUGIN_NAME}=http://host.docker.internal:9001"
    docker run --pull always --platform $CONSOLE_IMAGE_PLATFORM --rm -p "$CONSOLE_PORT":9000 --env-file <(set | grep BRIDGE) $CONSOLE_IMAGE
fi
