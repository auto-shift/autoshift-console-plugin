import type { ConfigMapResource, Component, Stack } from '../types/autoshift';
import { parseYamlKey } from './config';

/**
 * Stack grouping is the one fact the plugin cannot read off the cluster. Component lists,
 * gating labels, placements and compliance are all discovered at runtime; which components form
 * an application stack is editorial.
 *
 * Resolution order:
 *   1. ConfigMap autoshift-console-catalog in the plugin namespace (admin-editable, in-cluster)
 *   2. DEFAULT_STACKS below, versioned with the plugin image — never with an AutoShift release
 *   3. the Other bucket, so a component in neither still renders
 *
 * A component added to AutoShift therefore appears with no plugin rebuild; only its grouping
 * needs an edit, and only if "Other" is not good enough.
 */

export interface CatalogEntry {
  id: string;
  name: string;
  components: string[];
}

export const OTHER_STACK_ID = 'other';

export const DEFAULT_STACKS: CatalogEntry[] = [
  {
    id: 'ai',
    name: 'AI & Accelerators',
    components: ['openshift-ai', 'gpu-operator', 'node-feature-discovery'],
  },
  {
    id: 'security',
    name: 'Security & Compliance',
    components: [
      'advanced-cluster-security',
      'openshift-compliance-operator',
      'cert-manager',
      'external-secrets-operator',
      'trusted-artifact-signer',
      'vault',
    ],
  },
  {
    id: 'storage',
    name: 'Storage',
    components: [
      'openshift-data-foundation',
      'local-storage',
      'lvm',
      'trident',
      'storage-nodes',
      'openshift-image-registry',
    ],
  },
  {
    id: 'networking',
    name: 'Networking & Service Mesh',
    components: [
      'nmstate',
      'metallb',
      'connectivity-link',
      'servicemesh3operator',
      'servicemesh3-ambient',
      'kiali',
      'openshift-dns',
    ],
  },
  {
    id: 'observability',
    name: 'Observability',
    components: [
      'cluster-observability',
      'logging',
      'loki',
      'opentelemetry',
      'tempo',
      'user-workload-monitoring',
    ],
  },
  {
    id: 'devservices',
    name: 'Developer Services',
    components: [
      'developer-hub',
      'dev-spaces',
      'openshift-pipelines',
      'gitops-dev',
      'quay',
      'gitlab',
      'gitlab-runner',
      'jfrog',
      'cloudnative-pg',
    ],
  },
  {
    id: 'virtualization',
    name: 'Virtualization',
    components: ['openshift-virtualization', 'mtv'],
  },
  {
    id: 'automation',
    name: 'Automation',
    components: ['ansible-automation-platform'],
  },
  {
    id: 'nodes',
    name: 'Node Configuration',
    components: ['master-nodes', 'worker-nodes', 'infra-nodes', 'workload-partitioning'],
  },
  {
    id: 'platform',
    name: 'Platform & Fleet',
    components: [
      'advanced-cluster-management',
      'openshift-gitops',
      'autoshift-console',
      'cluster-labels',
      'cluster-config-maps',
      'cluster-install',
      'cluster-set-assignment',
      'openshift-upgrade',
      'policy-foundation',
      'machine-health-checks',
      'manual-remediations',
      'node-maintenance',
      'disconnected-mirror',
    ],
  },
];

/** Name of the optional in-cluster override, read from the plugin's own namespace. */
export const CATALOG_CONFIGMAP = 'autoshift-console-catalog';
export const CATALOG_NAMESPACE = 'autoshift-console';

interface RawCatalog {
  stacks?: unknown;
}

/**
 * Read the override ConfigMap. Expected shape under data.stacks (YAML):
 *
 *   stacks:
 *     - id: ai
 *       name: AI & Accelerators
 *       components: [openshift-ai, gpu-operator]
 *
 * A malformed or absent ConfigMap falls back to DEFAULT_STACKS rather than erroring — the page
 * must still render if an admin mistypes the override.
 */
export const parseCatalog = (cm: ConfigMapResource | undefined): CatalogEntry[] => {
  const parsed = parseYamlKey(cm, 'stacks') as RawCatalog;
  const raw = Array.isArray(parsed.stacks) ? parsed.stacks : undefined;
  if (!raw) {
    return DEFAULT_STACKS;
  }

  const entries = raw.flatMap((item): CatalogEntry[] => {
    if (typeof item !== 'object' || item === null) {
      return [];
    }
    const { id, name, components } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !Array.isArray(components)) {
      return [];
    }
    return [
      {
        id,
        name: typeof name === 'string' ? name : id,
        components: components.filter((c): c is string => typeof c === 'string'),
      },
    ];
  });

  return entries.length > 0 ? entries : DEFAULT_STACKS;
};

/**
 * Group discovered components into stacks.
 *
 * The catalog is an *override*, not the source of truth. Anything it does not name classifies
 * itself by the API group its policies manage, so a policy added to AutoShift lands in a sensible
 * group with no plugin rebuild — `cluster-set-assignment` under cluster.open-cluster-management.io,
 * `openshift-upgrade` under config.openshift.io, the node policies together under
 * machine.openshift.io.
 *
 * Only a component that manages nothing but generic resources (an operator install with no CR of
 * its own) is genuinely unclassifiable, and only those reach "Other".
 */
export const groupIntoStacks = (components: Component[], catalog: CatalogEntry[]): Stack[] => {
  const byName = new Map(components.map((c) => [c.name, c]));
  const claimed = new Set<string>();

  const stacks: Stack[] = catalog.map((entry) => {
    const members = entry.components.flatMap((name) => {
      const component = byName.get(name);
      if (!component) {
        return [];
      }
      claimed.add(name);
      return [component];
    });
    return { id: entry.id, name: entry.name, components: members };
  });

  const unclaimed = components.filter((c) => !claimed.has(c.name));

  // Self-classify the remainder by dominant API group.
  const derived = new Map<string, Component[]>();
  const unclassifiable: Component[] = [];
  unclaimed.forEach((component) => {
    // apiGroups is empty for an operator-only install; index 0 is genuinely absent then.
    const [group] = component.apiGroups;
    if (!group) {
      unclassifiable.push(component);
      return;
    }
    const existing = derived.get(group);
    if (existing) {
      existing.push(component);
    } else {
      derived.set(group, [component]);
    }
  });

  Array.from(derived.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([group, members]) => {
      stacks.push({
        id: `group-${group}`,
        name: group,
        components: members.sort((a, b) => a.name.localeCompare(b.name)),
      });
    });

  if (unclassifiable.length > 0) {
    stacks.push({
      id: OTHER_STACK_ID,
      name: 'Other',
      components: unclassifiable.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  return stacks.filter((s) => s.components.length > 0);
};

/**
 * Group components by support tier, read from each Argo CD Application's source path
 * (policies/<tier>/<name>). Unlike the curated stack list this is fully derived — it is the only
 * grouping the cluster itself actually knows about.
 *
 * Component *names* carry no usable theme: the leading token buckets eight unrelated things under
 * "openshift" and leaves most components as singletons, so name-prefix grouping is not offered.
 */
export const groupByTier = (components: Component[]): Stack[] => {
  const order = ['stable', 'certified', 'community'];
  const byTier = new Map<string, Component[]>();

  components.forEach((component) => {
    const tier = component.tier ?? 'unknown';
    const existing = byTier.get(tier);
    if (existing) {
      existing.push(component);
    } else {
      byTier.set(tier, [component]);
    }
  });

  return Array.from(byTier.entries())
    .sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || a.localeCompare(b);
    })
    .map(([tier, members]) => ({
      id: `tier-${tier}`,
      name: tier,
      components: members.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }));
};
