#!/usr/bin/env bash
# Capture a snapshot of a live AutoShift hub for src/lib/model.live.spec.ts.
#
# The unit tests in model.spec.ts prove the derivation is self-consistent. This fixture is what
# proves it agrees with the object shapes ACM and Argo CD actually produce — the assumptions most
# likely to be wrong. Re-capture after an ACM or GitOps upgrade.
#
# Usage:  oc login <autoshift-hub> && ./capture-fixture.sh [policy-namespace] [gitops-namespace]
#
# The output is git-ignored: it is a dump of a real cluster, and the shapes matter, not the values.

set -euo pipefail

POLICY_NS="${1:-policies-autoshift}"
GITOPS_NS="${2:-openshift-gitops}"
RELEASE="${POLICY_NS#policies-}"
OUT="$(dirname "$0")/fixtures/live"

if ! oc get ns "$POLICY_NS" >/dev/null 2>&1; then
  echo "namespace $POLICY_NS not found — is this an AutoShift hub?" >&2
  exit 1
fi

mkdir -p "$OUT"

echo "capturing AutoShift deployment '$RELEASE' from $POLICY_NS"

oc get cm -n "$POLICY_NS" -l autoshift.io/cluster-labels          -o json > "$OUT/labelcms.json"
oc get cm -n "$POLICY_NS" -l autoshift.io/cluster-default-configs -o json > "$OUT/defaults.json"
oc get cm -n "$POLICY_NS" -l autoshift.io/cluster-set-configs     -o json > "$OUT/setconfigs.json"
oc get cm -n "$POLICY_NS" -l autoshift.io/cluster-configs         -o json > "$OUT/clusterconfigs.json"
oc get cm -n "$POLICY_NS" -l autoshift.io/rendered-config-map     -o json > "$OUT/rendered.json"
oc get managedcluster                                             -o json > "$OUT/managedclusters.json"
oc get application.argoproj.io -n "$GITOPS_NS" -l "app=${RELEASE}-policies" -o json > "$OUT/apps.json"
oc get placement         -n "$POLICY_NS" -o json > "$OUT/placements.json"
oc get placementdecision -n "$POLICY_NS" -o json > "$OUT/decisions.json"
oc get placementbinding  -n "$POLICY_NS" -o json > "$OUT/bindings.json"
oc get policy            -n "$POLICY_NS" -o json > "$OUT/policies.json"

echo "wrote $(ls -1 "$OUT" | wc -l | tr -d ' ') files to $OUT"
echo "run: yarn test"
