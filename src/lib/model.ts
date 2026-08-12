import {
  AUTOSHIFT_LABEL_PREFIX,
  CLUSTERSET_LABEL,
  PLACEMENT_LABEL,
  PREFIX_CLUSTER_SET,
  PREFIX_CLUSTER_SET_CONFIG,
  PREFIX_MANAGED_CLUSTER,
  PREFIX_MANAGED_CLUSTER_CONFIG,
  SUFFIX_RENDERED_CONFIG,
} from '../k8s/models';
import {
  asStringMap,
  autoshiftLabels,
  buildProvenance,
  buildFeatures,
  lookupKey,
  managedApiGroups,
  mergeDesiredLabels,
  parseJsonKey,
  parseYamlKey,
} from './config';
import type { ConfigLayerInput, PlainObject } from './config';
import { groupIntoStacks, parseCatalog } from './catalog';
import type {
  ApplicationResource,
  PolicyCheck,
  ClusterSetView,
  ClusterView,
  ComplianceCounts,
  Component,
  ConfigMapResource,
  Deployment,
  FleetModel,
  ManagedClusterResource,
  PlacementBindingResource,
  PlacementDecisionResource,
  PlacementResource,
  PolicyResource,
} from '../types/autoshift';

const nameWithoutPrefix = (name: string, prefix: string): string | undefined =>
  name.startsWith(prefix) ? name.slice(prefix.length) : undefined;

const emptyCompliance = (): ComplianceCounts => ({ compliant: 0, nonCompliant: 0, pending: 0 });

const addCompliance = (counts: ComplianceCounts, compliant: string | undefined): void => {
  if (compliant === 'Compliant') {
    counts.compliant += 1;
  } else if (compliant === 'NonCompliant') {
    counts.nonCompliant += 1;
  } else {
    counts.pending += 1;
  }
};

/**
 * Link a Policy to the ArgoCD Application that delivered it.
 *
 * ArgoCD's resource tracking method is configurable, so every form is accepted: either instance
 * label, the tracking-id annotation, then a name-prefix match.
 *
 * OpenShift GitOps stamps argocd.argoproj.io/instance; upstream Argo CD defaults to
 * app.kubernetes.io/instance. The name-prefix match is genuinely last-resort: AutoShift policy
 * names do not always contain the directory name (ansible-automation-platform emits policy-aap-*),
 * so tracking metadata is what actually links most components.
 */
const trackedApp = (policy: PolicyResource): string | undefined => {
  const labels = policy.metadata?.labels ?? {};
  const instance = labels['argocd.argoproj.io/instance'] ?? labels['app.kubernetes.io/instance'];
  if (instance) {
    return instance;
  }
  const trackingId = policy.metadata?.annotations?.['argocd.argoproj.io/tracking-id'];
  return typeof trackingId === 'string' && trackingId.includes(':')
    ? trackingId.slice(0, trackingId.indexOf(':'))
    : undefined;
};

/**
 * Index policies by the Application that delivered them, in one pass.
 *
 * Matching per component instead would be components x policies string comparisons on every model
 * rebuild, and the model rebuilds whenever ACM touches any policy status — which is constantly.
 *
 * `untracked` holds policies carrying no Argo CD tracking metadata at all; only those fall back to
 * the name-prefix match, which is genuinely last-resort because AutoShift policy names do not
 * always contain the directory name (ansible-automation-platform emits policy-aap-*).
 */
const indexPoliciesByApp = (
  policies: PolicyResource[],
): { byApp: Map<string, PolicyResource[]>; untracked: PolicyResource[] } => {
  const byApp = new Map<string, PolicyResource[]>();
  const untracked: PolicyResource[] = [];

  policies.forEach((policy) => {
    const app = trackedApp(policy);
    if (app === undefined) {
      untracked.push(policy);
      return;
    }
    const existing = byApp.get(app);
    if (existing) {
      existing.push(policy);
    } else {
      byApp.set(app, [policy]);
    }
  });

  return { byApp, untracked };
};

const matchesComponentName = (policy: PolicyResource, component: string): boolean => {
  const name = policy.metadata?.name ?? '';
  return name === `policy-${component}` || name.startsWith(`policy-${component}-`);
};

/** Gating autoshift.io/* label keys a Placement selects on. */
const gatingLabelsOf = (placement: PlacementResource): string[] => {
  const keys = new Set<string>();
  (placement.spec?.predicates ?? []).forEach((p) => {
    const selector = p.requiredClusterSelector?.labelSelector;
    (selector?.matchExpressions ?? []).forEach((e) => keys.add(e.key));
    Object.keys(selector?.matchLabels ?? {}).forEach((k) => keys.add(k));
  });
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
};

/** Everything buildFleetModel needs, exactly as the watches return it. */
export interface FleetModelInputs {
  deployment: Deployment;
  labelConfigMaps?: ConfigMapResource[];
  defaultConfigMaps?: ConfigMapResource[];
  setConfigMaps?: ConfigMapResource[];
  clusterConfigMaps?: ConfigMapResource[];
  renderedConfigMaps?: ConfigMapResource[];
  managedClusters?: ManagedClusterResource[];
  applications?: ApplicationResource[];
  placements?: PlacementResource[];
  placementDecisions?: PlacementDecisionResource[];
  placementBindings?: PlacementBindingResource[];
  policies?: PolicyResource[];
  catalogConfigMap?: ConfigMapResource;
}

/**
 * Derive the fleet model from live cluster objects.
 *
 * Pure on purpose: this is the part that has to agree with how AutoShift actually resolves
 * config and labels, so it is unit-testable against a snapshot of a real hub.
 */
export const buildFleetModel = (inputs: FleetModelInputs): FleetModel => {
  const {
    deployment,
    labelConfigMaps,
    defaultConfigMaps,
    setConfigMaps,
    clusterConfigMaps,
    renderedConfigMaps,
    managedClusters,
    applications,
    placements,
    placementDecisions,
    placementBindings,
    policies,
    catalogConfigMap,
  } = inputs;
  const release = deployment.release;

  // ---- desired labels + config, keyed by clusterset / cluster ----
  const setLabels = new Map<string, Record<string, string>>();
  const clusterLabels = new Map<string, Record<string, string>>();
  (labelConfigMaps ?? []).forEach((cm) => {
    const name = cm.metadata?.name ?? '';
    const labels = asStringMap(parseJsonKey(cm, 'labels'));
    const setName = nameWithoutPrefix(name, PREFIX_CLUSTER_SET);
    const clusterName = nameWithoutPrefix(name, PREFIX_MANAGED_CLUSTER);
    if (setName !== undefined) {
      setLabels.set(setName, labels);
    } else if (clusterName !== undefined) {
      clusterLabels.set(clusterName, labels);
    }
  });

  const defaultConfig: PlainObject = parseJsonKey(defaultConfigMaps?.[0], 'config');

  const setConfigs = new Map<string, PlainObject>();
  (setConfigMaps ?? []).forEach((cm) => {
    const setName = nameWithoutPrefix(cm.metadata?.name ?? '', PREFIX_CLUSTER_SET_CONFIG);
    if (setName !== undefined) {
      setConfigs.set(setName, parseJsonKey(cm, 'config'));
    }
  });

  const clusterConfigs = new Map<string, PlainObject>();
  (clusterConfigMaps ?? []).forEach((cm) => {
    const clusterName = nameWithoutPrefix(cm.metadata?.name ?? '', PREFIX_MANAGED_CLUSTER_CONFIG);
    if (clusterName !== undefined) {
      clusterConfigs.set(clusterName, parseJsonKey(cm, 'config'));
    }
  });

  const rendered = new Map<string, PlainObject>();
  (renderedConfigMaps ?? []).forEach((cm) => {
    const name = cm.metadata?.name ?? '';
    if (name.endsWith(SUFFIX_RENDERED_CONFIG)) {
      rendered.set(name.slice(0, -SUFFIX_RENDERED_CONFIG.length), parseYamlKey(cm, 'config'));
    }
  });

  // ---- per-cluster compliance from the deployment's policies ----
  const complianceByCluster = new Map<string, ComplianceCounts>();
  const checksByCluster = new Map<string, PolicyCheck[]>();
  (policies ?? []).forEach((policy) => {
    const policyName = policy.metadata?.name ?? '';
    (policy.status?.status ?? []).forEach((entry) => {
      const counts = complianceByCluster.get(entry.clustername) ?? emptyCompliance();
      addCompliance(counts, entry.compliant);
      complianceByCluster.set(entry.clustername, counts);

      const checks = checksByCluster.get(entry.clustername) ?? [];
      checks.push({ policy: policyName, cluster: entry.clustername, compliant: entry.compliant });
      checksByCluster.set(entry.clustername, checks);
    });
  });

  // NonCompliant first, then Pending, then Compliant: a compliance view is read to find what is
  // broken, so burying failures under an alphabetical list of passes wastes the reader's time.
  const rank = (c?: string): number => (c === 'NonCompliant' ? 0 : c === 'Compliant' ? 2 : 1);
  const sortChecks = (checks: PolicyCheck[]): PolicyCheck[] =>
    checks
      .slice()
      .sort(
        (a, b) =>
          rank(a.compliant) - rank(b.compliant) ||
          a.cluster.localeCompare(b.cluster) ||
          a.policy.localeCompare(b.policy),
      );

  // ---- clusters ----
  const clusters: ClusterView[] = (managedClusters ?? [])
    .map((mc) => {
      const name = mc.metadata?.name ?? '';
      const allLabels = mc.metadata?.labels ?? {};
      const clusterSet = lookupKey(allLabels, CLUSTERSET_LABEL);
      const actual = autoshiftLabels(allLabels);
      const desired = mergeDesiredLabels(
        (clusterSet === undefined ? undefined : setLabels.get(clusterSet)) ?? {},
        clusterLabels.get(name) ?? {},
      );

      const layers: ConfigLayerInput[] = [
        { layer: 'default', source: 'default-configs', config: defaultConfig },
      ];
      const setConfig = clusterSet === undefined ? undefined : setConfigs.get(clusterSet);
      if (clusterSet !== undefined && setConfig !== undefined) {
        layers.push({
          layer: 'clusterSet',
          source: `${PREFIX_CLUSTER_SET_CONFIG}${clusterSet}`,
          config: setConfig,
        });
      }
      const clusterConfig = clusterConfigs.get(name);
      if (clusterConfig !== undefined) {
        layers.push({
          layer: 'cluster',
          source: `${PREFIX_MANAGED_CLUSTER_CONFIG}${name}`,
          config: clusterConfig,
        });
      }

      const resolvedConfig = rendered.get(name) ?? {};
      const available =
        mc.status?.conditions?.some(
          (c) => c.type === 'ManagedClusterConditionAvailable' && c.status === 'True',
        ) ?? false;
      const openshiftVersion = mc.status?.clusterClaims?.find(
        (c) => c.name === 'version.openshift.io',
      )?.value;
      const desiredVersion = lookupKey(desired, `${AUTOSHIFT_LABEL_PREFIX}openshift-version`);

      return {
        name,
        clusterSet,
        clusterType: lookupKey(actual, `${AUTOSHIFT_LABEL_PREFIX}cluster-type`),
        selfManaged: lookupKey(actual, `${AUTOSHIFT_LABEL_PREFIX}self-managed`) === 'true',
        owningNamespace: lookupKey(actual, `${AUTOSHIFT_LABEL_PREFIX}owning-namespace`),
        owningDeployment: lookupKey(actual, `${AUTOSHIFT_LABEL_PREFIX}owning-deployment`),
        available,
        desiredVersion,
        kubernetesVersion: mc.status?.version?.kubernetes,
        openshiftVersion,
        desiredLabels: desired,
        actualLabels: actual,
        upgradePending:
          !!desiredVersion && !!openshiftVersion && desiredVersion !== openshiftVersion,
        resolvedConfig,
        provenance: buildProvenance(layers, resolvedConfig),
        compliance: complianceByCluster.get(name) ?? emptyCompliance(),
        checks: sortChecks(checksByCluster.get(name) ?? []),
      };
    })
    // Only clusters this deployment owns. Clusters whose clusterset has no ConfigMap here
    // belong to a different AutoShift deployment on the same hub.
    .filter((c) => !c.clusterSet || setLabels.has(c.clusterSet) || setConfigs.has(c.clusterSet))
    .sort((a, b) => a.name.localeCompare(b.name));

  // ---- cluster sets ----
  const clusterSets: ClusterSetView[] = Array.from(
    new Set(Array.from(setLabels.keys()).concat(Array.from(setConfigs.keys()))),
  )
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const labels = setLabels.get(name) ?? {};
      return {
        name,
        labels,
        config: setConfigs.get(name) ?? {},
        clusters: clusters.filter((c) => c.clusterSet === name).map((c) => c.name),
        enabled: Object.entries(labels)
          .filter(([, v]) => v === 'true')
          .map(([k]) => k)
          .sort((a, b) => a.localeCompare(b)),
        // Filled in below, once components are known.
        features: [],
      };
    });

  // ---- components, from ArgoCD Applications + Placements + PlacementDecisions ----
  const decisionsByPlacement = new Map<string, string[]>();
  (placementDecisions ?? []).forEach((pd) => {
    const placementName = pd.metadata?.labels?.[PLACEMENT_LABEL];
    if (!placementName) {
      return;
    }
    const existing = decisionsByPlacement.get(placementName) ?? [];
    (pd.status?.decisions ?? []).forEach((d) => existing.push(d.clusterName));
    decisionsByPlacement.set(placementName, existing);
  });

  const placementForPolicy = new Map<string, string>();
  (placementBindings ?? []).forEach((pb) => {
    const placementName = pb.placementRef?.name;
    if (!placementName) {
      return;
    }
    (pb.subjects ?? []).forEach((s) => {
      if (s.kind === 'Policy') {
        placementForPolicy.set(s.name, placementName);
      }
    });
  });

  const placementsByName = new Map(
    (placements ?? []).map((p) => [p.metadata?.name ?? '', p] as const),
  );

  const policyIndex = indexPoliciesByApp(policies ?? []);

  const components: Component[] = (applications ?? [])
    .map((app) => {
      const applicationName = app.metadata?.name ?? '';

      // The Argo CD source path is policies/<tier>/<name> in git mode, giving both the support
      // tier and a component name that does not depend on parsing a release prefix off the
      // Application name. OCI mode ships charts with no path, so fall back to the prefix.
      const sourcePath = app.spec?.sources?.[0]?.path ?? app.spec?.source?.path;
      const segments = sourcePath?.split('/') ?? [];
      const fromPath = segments[0] === 'policies' && segments.length >= 3 ? segments : undefined;
      const tier = fromPath?.[1];
      const name =
        fromPath?.[2] ??
        (release
          ? (nameWithoutPrefix(applicationName, `${release}-`) ?? applicationName)
          : applicationName);

      const owned = (policyIndex.byApp.get(applicationName) ?? []).concat(
        policyIndex.untracked.filter((p) => matchesComponentName(p, name)),
      );

      const compliance = emptyCompliance();
      const componentChecks: PolicyCheck[] = [];
      owned.forEach((p) => {
        (p.status?.status ?? []).forEach((s) => {
          addCompliance(compliance, s.compliant);
          componentChecks.push({
            policy: p.metadata?.name ?? '',
            cluster: s.clustername,
            compliant: s.compliant,
          });
        });
      });

      const gatingLabels = new Set<string>();
      const componentClusters = new Set<string>();
      owned.forEach((p) => {
        const placementName = placementForPolicy.get(p.metadata?.name ?? '');
        if (!placementName) {
          return;
        }
        const placement = placementsByName.get(placementName);
        if (placement) {
          gatingLabelsOf(placement).forEach((k) => gatingLabels.add(k));
        }
        (decisionsByPlacement.get(placementName) ?? []).forEach((c) => componentClusters.add(c));
      });

      return {
        name,
        applicationName,
        tier,
        apiGroups: managedApiGroups(owned.map((p) => p.spec)),
        syncStatus: app.status?.sync?.status,
        healthStatus: app.status?.health?.status,
        gatingLabels: Array.from(gatingLabels).sort((a, b) => a.localeCompare(b)),
        clusters: Array.from(componentClusters).sort((a, b) => a.localeCompare(b)),
        policies: owned.map((p) => p.metadata?.name ?? '').sort((a, b) => a.localeCompare(b)),
        compliance,
        checks: sortChecks(componentChecks),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Features join labels to config and to the components that deliver them. Done after components
  // are built because the label -> component link comes from each Placement's gating label.
  const featureInputs = components.map((c) => ({
    name: c.name,
    gatingLabels: c.gatingLabels,
    clusters: c.clusters,
    syncStatus: c.syncStatus,
    healthStatus: c.healthStatus,
  }));
  clusterSets.forEach((set) => {
    set.features = buildFeatures(set.labels, set.config, featureInputs);
  });

  // Every policy Application tracks the same revision, so the first one that declares it is the
  // deployment's version. Sourced here rather than in the deployment-list hook, which would need a
  // cluster-wide Application watch to find it.
  const version = (applications ?? [])
    .map((a) => (a.spec?.sources?.[0] ?? a.spec?.source)?.targetRevision)
    .find((v) => !!v);

  return {
    deployment: { ...deployment, version: deployment.version ?? version },
    clusters,
    clusterSets,
    components,
    stacks: groupIntoStacks(components, parseCatalog(catalogConfigMap)),
  };
};
