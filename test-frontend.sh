#!/usr/bin/env bash

set -euo pipefail

# https://ci-operator-configresolver-ui-ci.apps.ci.l2s4.p1.openshiftapps.com/help#env
OPENSHIFT_CI=${OPENSHIFT_CI:=false}
ARTIFACT_DIR=${ARTIFACT_DIR:=/tmp/artifacts}

# Which OpenShift target to test. Defaults to the newest declared, matching scripts/ocp.sh.
if [ -z "${OCP_TARGET:-}" ]; then
  OCP_TARGET=$(node -e "
    const t = Object.keys(require('./ocp-targets.json').targets);
    process.stdout.write(t[t.length - 1]);
  ")
fi
export OCP_TARGET

# Two trees: the root toolchain and this target's module-federation contract. jest resolves react
# and PatternFly out of the second one, so skipping it would test against nothing.
if [ ! -d node_modules ]; then
  yarn install --immutable
fi
if [ ! -d "targets/${OCP_TARGET}/node_modules" ]; then
  (cd "targets/${OCP_TARGET}" && yarn install --immutable)
fi

yarn i18n
GIT_STATUS="$(git status --short --untracked-files -- locales)"
if [ -n "$GIT_STATUS" ]; then
  echo "i18n files are not up to date. Run 'yarn i18n' then commit changes."
  git --no-pager diff
  exit 1
fi

# Checked per tree, since each has its own lockfile.
for TREE in . "targets/${OCP_TARGET}"; do
  if ! (cd "$TREE" && yarn dedupe --strategy highest --check) ; then
    echo "Duplicate version resolutions in ${TREE}/yarn.lock. Run 'yarn dedupe' there and commit it."
    (cd "$TREE" && yarn dedupe --strategy highest)
    git --no-pager diff
    exit 1
  fi
done

if [ "$OPENSHIFT_CI" = true ]; then
  JEST_SUITE_NAME="Plugin unit tests" JEST_JUNIT_OUTPUT_DIR="$ARTIFACT_DIR" yarn run test --ci --maxWorkers=2 --reporters=default --reporters=jest-junit
else
  yarn run test
fi
