import * as fs from 'fs';
import * as path from 'path';
import { buildFleetModel } from './model';
import { groupByTier } from './catalog';
import { AUTO_STAMPED_LABELS } from './config';
import type {
  ApplicationResource,
  ConfigMapResource,
  ManagedClusterResource,
  PlacementBindingResource,
  PlacementDecisionResource,
  PlacementResource,
  PolicyResource,
} from '../types/autoshift';

/**
 * Runs the derivation against a snapshot of a real AutoShift hub.
 *
 * The fixture is captured with capture-fixture.sh from a live cluster. It is what proves the
 * discovery layer agrees with the object shapes ACM and Argo CD actually produce — the unit tests
 * in model.spec.ts only prove the logic is self-consistent.
 *
 * Skipped when no fixture is present so CI stays green without a cluster.
 */
const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/live');

const read = <T>(file: string): T[] => {
  const full = path.join(FIXTURE_DIR, file);
  if (!fs.existsSync(full)) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(full, 'utf-8')) as { items?: T[] };
  return parsed.items ?? [];
};

const hasFixture = fs.existsSync(path.join(FIXTURE_DIR, 'managedclusters.json'));
const describeLive = hasFixture ? describe : describe.skip;

describeLive('buildFleetModel against a live hub snapshot', () => {
  const model = buildFleetModel({
    deployment: { release: 'autoshift', policyNamespace: 'policies-autoshift', version: 'main' },
    labelConfigMaps: read<ConfigMapResource>('labelcms.json'),
    defaultConfigMaps: read<ConfigMapResource>('defaults.json'),
    setConfigMaps: read<ConfigMapResource>('setconfigs.json'),
    clusterConfigMaps: read<ConfigMapResource>('clusterconfigs.json'),
    renderedConfigMaps: read<ConfigMapResource>('rendered.json'),
    managedClusters: read<ManagedClusterResource>('managedclusters.json'),
    applications: read<ApplicationResource>('apps.json'),
    placements: read<PlacementResource>('placements.json'),
    placementDecisions: read<PlacementDecisionResource>('decisions.json'),
    placementBindings: read<PlacementBindingResource>('bindings.json'),
    policies: read<PolicyResource>('policies.json'),
  });

  it('discovers the hub cluster and its cluster set', () => {
    const local = model.clusters.find((c) => c.name === 'local-cluster');
    expect(local).toBeDefined();
    expect(local?.clusterSet).toBe('hub');
    expect(local?.clusterType).toBe('hub');
    expect(local?.selfManaged).toBe(true);
    expect(local?.available).toBe(true);
  });

  it('resolves desired labels and drops the delete sentinel', () => {
    const local = model.clusters.find((c) => c.name === 'local-cluster');
    // The hub profile enables a large label set; the exact count varies with the values files.
    expect(Object.keys(local?.desiredLabels ?? {}).length).toBeGreaterThan(100);
    expect(Object.values(local?.desiredLabels ?? {})).not.toContain('_');
  });

  it('reads the resolved config out of rendered-config', () => {
    const local = model.clusters.find((c) => c.name === 'local-cluster');
    expect(Object.keys(local?.resolvedConfig ?? {}).length).toBeGreaterThan(0);
    expect(local?.provenance.length).toBeGreaterThan(0);
  });

  it('discovers both cluster sets', () => {
    expect(model.clusterSets.map((s) => s.name).sort()).toEqual(['hub', 'managed']);
    const hub = model.clusterSets.find((s) => s.name === 'hub');
    expect(hub?.clusters).toEqual(['local-cluster']);
    expect(hub?.enabled.length).toBeGreaterThan(0);
  });

  it('discovers every component from its ArgoCD Application', () => {
    expect(model.components.length).toBeGreaterThan(40);
    expect(model.components.map((c) => c.name)).toContain('nmstate');
    expect(model.components.map((c) => c.name)).toContain('ansible-automation-platform');
  });

  it('links policies to components even when policy names differ from the directory', () => {
    // ansible-automation-platform emits policy-aap-*, so this only works via Argo CD tracking
    // metadata — it is the case the name-prefix fallback cannot cover.
    const aap = model.components.find((c) => c.name === 'ansible-automation-platform');
    expect(aap?.policies.length).toBeGreaterThan(0);
    expect(aap?.policies.some((p) => p.startsWith('policy-aap-'))).toBe(true);
  });

  it('resolves each component gating label from its Placement', () => {
    const nmstate = model.components.find((c) => c.name === 'nmstate');
    expect(nmstate?.gatingLabels).toContain('autoshift.io/nmstate');
  });

  it('reflects the gating label in the placed clusters, both ways', () => {
    // acs is 'true' on this hub and acs-gated policies are placed; nmstate is 'false', so its
    // PlacementDecision exists but selects nothing. An empty cluster list is the correct answer,
    // not a discovery failure.
    const acs = model.components.find((c) => c.name === 'advanced-cluster-security');
    expect(acs?.clusters).toContain('local-cluster');

    const nmstate = model.components.find((c) => c.name === 'nmstate');
    expect(nmstate?.clusters).toEqual([]);
  });

  it('groups components into stacks with nothing left unaccounted for', () => {
    const grouped = model.stacks.flatMap((s) => s.components.map((c) => c.name));
    expect(grouped.sort()).toEqual(model.components.map((c) => c.name).sort());
  });

  it('collapses the hub cluster set label wall into a readable feature list', () => {
    const hub = model.clusterSets.find((s) => s.name === 'hub');
    const labelCount = Object.keys(hub?.labels ?? {}).length;
    // The raw label set is several hundred entries; grouping must produce far fewer rows.
    expect(labelCount).toBeGreaterThan(250);
    expect(hub?.features.length).toBeLessThan(labelCount / 3);
    // Every label is still accounted for exactly once: a family toggle plus its settings.
    const accounted = (hub?.features ?? []).reduce(
      (n, f) => n + (f.value === undefined ? 0 : 1) + f.settings.length,
      0,
    );
    expect(accounted).toBe(labelCount);
  });

  it('does not emit a bare token group beside the longer feature it prefixes', () => {
    const hub = model.clusterSets.find((s) => s.name === 'hub');
    const names = new Set((hub?.features ?? []).map((f) => f.name));
    // Every one of these appeared as a junk group alongside its real feature before the
    // vocabulary-driven grouping landed.
    ['cert', 'cloudnative', 'dev', 'external', 'local', 'machine', 'node', 'storage'].forEach(
      (junk) => {
        expect(names.has(junk)).toBe(false);
      },
    );
    expect(names.has('cert-manager')).toBe(true);
    expect(names.has('cloudnative-pg')).toBe(true);
    expect(names.has('local-storage')).toBe(true);
    expect(names.has('machine-health-checks')).toBe(true);
  });

  it('keeps features that merely share a token apart', () => {
    const hub = model.clusterSets.find((s) => s.name === 'hub');
    const names = new Set((hub?.features ?? []).map((f) => f.name));
    expect(names.has('node-feature-discovery')).toBe(true);
    expect(names.has('node-maintenance')).toBe(true);
  });

  it('collects acm settings into one feature instead of splitting acm-source off', () => {
    const hub = model.clusterSets.find((s) => s.name === 'hub');
    const names = (hub?.features ?? []).map((f) => f.name).filter((n) => n.startsWith('acm'));
    expect(names).toEqual(['acm']);
    const acm = hub?.features.find((f) => f.name === 'acm');
    expect(acm?.settings.length).toBeGreaterThan(10);
  });

  it('joins a feature to the config block it owns', () => {
    const hub = model.clusterSets.find((s) => s.name === 'hub');
    const acs = hub?.features.find((f) => f.name === 'acs');
    expect(acs?.configKey).toBe('acs');
    expect(acs?.config.length).toBeGreaterThan(0);
    expect(acs?.config.map((c) => c.path)).toContain('admissionControl.enabled');
  });

  it('joins a feature to the components its labels gate', () => {
    const hub = model.clusterSets.find((s) => s.name === 'hub');
    const acs = hub?.features.find((f) => f.name === 'acs');
    expect(acs?.components.map((c) => c.name)).toContain('advanced-cluster-security');
  });

  it('leaves a pure toggle with no config block rather than inventing one', () => {
    const hub = model.clusterSets.find((s) => s.name === 'hub');
    const withoutConfig = hub?.features.filter((f) => f.config.length === 0) ?? [];
    expect(withoutConfig.length).toBeGreaterThan(0);
    expect(withoutConfig.every((f) => f.configKey === undefined)).toBe(true);
  });

  it('derives the support tier from the Application source path', () => {
    const tiers = new Set(model.components.map((c) => c.tier));
    expect(tiers.has('stable')).toBe(true);
    expect(tiers.has(undefined)).toBe(false);
    const acs = model.components.find((c) => c.name === 'advanced-cluster-security');
    expect(acs?.tier).toBe('stable');
  });

  it('groups by tier without losing any component', () => {
    const grouped = groupByTier(model.components).flatMap((s) => s.components.map((c) => c.name));
    expect(grouped.sort()).toEqual(model.components.map((c) => c.name).sort());
  });

  it('classifies a component by the API groups its policies manage', () => {
    const csa = model.components.find((c) => c.name === 'cluster-set-assignment');
    expect(csa?.apiGroups[0]).toBe('cluster.open-cluster-management.io');
    const upgrade = model.components.find((c) => c.name === 'openshift-upgrade');
    expect(upgrade?.apiGroups[0]).toBe('config.openshift.io');
  });

  it('never drops a newly added component into a bare Other bucket', () => {
    // Neither of these is in the built-in catalog, so both exercise auto-classification.
    const named = new Map(
      model.stacks.flatMap((s) => s.components.map((c) => [c.name, s.name] as const)),
    );
    expect(named.get('cluster-set-assignment')).toBe('Platform & Fleet');
    expect(named.get('openshift-upgrade')).toBe('Platform & Fleet');
    // Only components managing nothing but generic resources may reach Other.
    const other = model.stacks.find((s) => s.name === 'Other');
    expect((other?.components ?? []).every((c) => c.apiGroups.length === 0)).toBe(true);
  });

  /*
   * This is why the plugin shows no label drift.
   *
   * cluster-labels is a mustonlyhave + enforce policy, so on a healthy hub the stamped labels
   * equal the desired labels, always. A client-side desired-vs-actual diff could therefore only
   * ever report a transient mid-reconcile state or a bug in this plugin's own merge — never a
   * genuine configuration problem. The policy's own compliance status is the real signal, and it
   * is already shown on the Compliance tab.
   *
   * If this test starts failing, the enforcement assumption has changed and the decision to drop
   * drift needs revisiting. Do not weaken the assertion.
   */
  it('has desired labels already reconciled onto every ManagedCluster', () => {
    model.clusters.forEach((cluster) => {
      Object.entries(cluster.desiredLabels).forEach(([key, value]) => {
        expect([cluster.name, key, cluster.actualLabels[key]]).toEqual([cluster.name, key, value]);
      });

      // The only stamped labels absent from the values files are the ones AutoShift stamps itself.
      const extra = Object.keys(cluster.actualLabels)
        .filter((k) => !Object.hasOwn(cluster.desiredLabels, k))
        .filter((k) => !AUTO_STAMPED_LABELS.has(k));
      expect([cluster.name, extra]).toEqual([cluster.name, []]);
    });

    const local = model.clusters.find((c) => c.name === 'local-cluster');
    expect(local?.actualLabels['autoshift.io/owning-namespace']).toBe('policies-autoshift');
    // Delete-sentinel labels are dropped from desired, so they never read as unstamped.
    expect(Object.values(local?.desiredLabels ?? {})).not.toContain('_');
  });

  it('carries per-policy verdicts so a failure can be traced to a cluster', () => {
    const local = model.clusters.find((c) => c.name === 'local-cluster');
    expect(local?.checks.length).toBeGreaterThan(0);
    // Every check belongs to the cluster it is filed under.
    expect(local?.checks.every((c) => c.cluster === 'local-cluster')).toBe(true);
    // Counts and detail must agree, or the drill-down contradicts the summary.
    const counted =
      (local?.compliance.compliant ?? 0) +
      (local?.compliance.nonCompliant ?? 0) +
      (local?.compliance.pending ?? 0);
    expect(local?.checks.length).toBe(counted);
  });

  it('sorts failures ahead of passes', () => {
    const local = model.clusters.find((c) => c.name === 'local-cluster');
    const rank = (c?: string) => (c === 'NonCompliant' ? 0 : c === 'Compliant' ? 2 : 1);
    const ranks = (local?.checks ?? []).map((c) => rank(c.compliant));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('gives each component the verdicts behind its compliance figure', () => {
    const acs = model.components.find((c) => c.name === 'advanced-cluster-security');
    const counted =
      (acs?.compliance.compliant ?? 0) +
      (acs?.compliance.nonCompliant ?? 0) +
      (acs?.compliance.pending ?? 0);
    expect(acs?.checks.length).toBe(counted);
    expect(acs?.checks.every((c) => c.policy.length > 0 && c.cluster.length > 0)).toBe(true);
  });

  it('reads the owning deployment off the cluster', () => {
    const local = model.clusters.find((c) => c.name === 'local-cluster');
    expect(local?.owningDeployment).toBe('autoshift');
    expect(local?.owningNamespace).toBe('policies-autoshift');
  });

  it('counts compliance per cluster from policy status', () => {
    const local = model.clusters.find((c) => c.name === 'local-cluster');
    const total =
      (local?.compliance.compliant ?? 0) +
      (local?.compliance.nonCompliant ?? 0) +
      (local?.compliance.pending ?? 0);
    expect(total).toBeGreaterThan(0);
  });
});
