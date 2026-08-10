import { execSync } from 'child_process';
import { test, expect } from '@playwright/test';
import { checkErrors } from '../support';

const PLUGIN_NAME = 'autoshift-console';
// Defined in openshift/release ci-operator config as CYPRESS_PLUGIN_TEMPLATE_PULL_SPEC
const PLUGIN_PULL_SPEC =
  process.env.PLUGIN_TEMPLATE_PULL_SPEC ?? process.env.CYPRESS_PLUGIN_TEMPLATE_PULL_SPEC;

const isLocalDevEnvironment = (process.env.BRIDGE_BASE_ADDRESS ?? 'http://localhost:9000').includes(
  'localhost',
);

function exec(command: string, timeoutMs = 360000) {
  try {
    return execSync(command, { timeout: timeoutMs, encoding: 'utf-8' });
  } catch (e) {
    console.error('Command failed:', command, e);
    return '';
  }
}

function installHelmChart(helmPath: string) {
  const result = exec(
    `${helmPath} upgrade -i ${PLUGIN_NAME} charts/openshift-console-plugin -n ${PLUGIN_NAME} --create-namespace --set plugin.image=${PLUGIN_PULL_SPEC}`,
  );
  console.log('Helm install:', result);

  exec(`oc rollout status -n ${PLUGIN_NAME} deploy/${PLUGIN_NAME} -w --timeout=300s`);
  exec('oc rollout status -w deploy/console -n openshift-console --timeout=300s');
}

function deleteHelmChart(helmPath: string) {
  const result = exec(
    `${helmPath} uninstall ${PLUGIN_NAME} -n ${PLUGIN_NAME} && oc delete namespaces ${PLUGIN_NAME}`,
  );
  console.log('Helm uninstall:', result);
}

test.describe('AutoShift console plugin', () => {
  test.beforeAll(() => {
    if (!isLocalDevEnvironment) {
      console.log('this is not a local env, installing helm');
      exec('./install_helm.sh');
      installHelmChart('/tmp/helm');
    } else {
      console.log('this is a local env, not installing helm');
      installHelmChart('helm');
    }
  });

  test.afterEach(async ({ page }) => {
    await checkErrors(page);
  });

  test.afterAll(() => {
    if (!isLocalDevEnvironment) {
      deleteHelmChart('/tmp/helm');
    } else {
      deleteHelmChart('helm');
    }
  });

  test('adds an AutoShift section with all four pages to the sidebar', async ({ page }) => {
    await page.goto('/');

    // The section is collapsed until its heading is clicked.
    await page.getByTestId('nav').getByText('AutoShift', { exact: true }).click();

    for (const [name, path] of [
      ['Fleet', '/autoshift/fleet'],
      ['Cluster Sets', '/autoshift/cluster-sets'],
      ['Clusters', '/autoshift/clusters'],
      ['Stacks', '/autoshift/stacks'],
    ] as const) {
      await page.getByTestId('nav').getByText(name, { exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}(\\?|$)`));
    }
  });

  test('highlights only the page being viewed', async ({ page }) => {
    // No nav href may be a string prefix of another, or the console marks both active: /autoshift
    // would match every page, and /autoshift/clusters would match /autoshift/clustersets.
    for (const [name, path] of [
      ['Clusters', '/autoshift/clusters'],
      ['Cluster Sets', '/autoshift/cluster-sets'],
    ] as const) {
      await page.goto(path);
      const active = page.getByTestId('nav').locator('li.pf-m-current a');
      await expect(active).toHaveCount(1);
      await expect(active).toHaveText(name);
    }
  });

  test('renders the fleet page without crashing on a hub with no AutoShift state', async ({
    page,
  }) => {
    await page.goto('/autoshift');
    // Either the fleet renders or the empty state explains why — never a blank page.
    await expect(
      page.getByText(/AutoShift fleet|No AutoShift deployment found/).first(),
    ).toBeVisible();
  });
});
