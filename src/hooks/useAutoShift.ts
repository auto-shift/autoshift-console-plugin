import { useMemo } from 'react';
import { useWatch } from './useWatch';
import {
  ApplicationGVK,
  ConfigMapGVK,
  ManagedClusterGVK,
  POLICY_NAMESPACE_PREFIX,
  PlacementBindingGVK,
  PlacementDecisionGVK,
  PlacementGVK,
  PolicyGVK,
  SELECTOR_CLUSTER_CONFIGS,
  SELECTOR_CLUSTER_LABELS,
  SELECTOR_CLUSTER_SET_CONFIGS,
  SELECTOR_DEFAULT_CONFIGS,
  SELECTOR_RENDERED_CONFIG,
} from '../k8s/models';
import { buildFleetModel } from '../lib/model';
import { toFailure } from '../lib/errors';
import { CATALOG_CONFIGMAP, CATALOG_NAMESPACE } from '../lib/catalog';
import type { WatchFailure } from '../lib/errors';
import type {
  ApplicationResource,
  ConfigMapResource,
  Deployment,
  FleetModel,
  ManagedClusterResource,
  PlacementBindingResource,
  PlacementDecisionResource,
  PlacementResource,
  PolicyResource,
} from '../types/autoshift';

const existsSelector = (key: string) => ({
  matchExpressions: [{ key, operator: 'Exists' as const }],
});

const nameWithoutPrefix = (name: string, prefix: string): string | undefined =>
  name.startsWith(prefix) ? name.slice(prefix.length) : undefined;

export interface WatchState {
  loaded: boolean;
  error?: unknown;
  /** Watches that failed, so the UI can say what is hidden rather than showing it as absent. */
  failures?: WatchFailure[];
}

/**
 * Discover the AutoShift deployments on this hub.
 *
 * Keyed off the cluster-labels ConfigMaps rather than the ApplicationSet: those ConfigMaps are the
 * data the plugin fundamentally needs, so a namespace that has them is by definition renderable,
 * and one that does not would produce an empty deployment regardless.
 */
export const useAutoShiftDeployments = (): { deployments: Deployment[] } & WatchState => {
  const [configMaps, loaded, error] = useWatch<ConfigMapResource[]>({
    groupVersionKind: ConfigMapGVK,
    isList: true,
    selector: existsSelector(SELECTOR_CLUSTER_LABELS),
  });

  const [applications] = useWatch<ApplicationResource[]>({
    groupVersionKind: ApplicationGVK,
    isList: true,
  });

  const deployments = useMemo<Deployment[]>(() => {
    const namespaces = new Set(
      (configMaps ?? []).map((cm) => cm.metadata?.namespace).filter((ns): ns is string => !!ns),
    );

    return Array.from(namespaces)
      .sort((a, b) => a.localeCompare(b))
      .map((policyNamespace) => {
        const release =
          nameWithoutPrefix(policyNamespace, POLICY_NAMESPACE_PREFIX) ?? policyNamespace;
        const app = (applications ?? []).find(
          (a) => a.metadata?.labels?.app === `${release}-policies`,
        );
        const source = app?.spec?.sources?.[0] ?? app?.spec?.source;
        return { release, policyNamespace, version: source?.targetRevision };
      });
  }, [configMaps, applications]);

  const failures = [toFailure('cluster label ConfigMaps', error)].filter(
    (f): f is WatchFailure => f !== undefined,
  );

  return { deployments, loaded, error, failures };
};

/**
 * Assemble the full fleet model for one AutoShift deployment.
 *
 * Every field is derived from live objects. Nothing is read from a build-time manifest, so a
 * policy added to AutoShift shows up here without a plugin rebuild.
 */
export const useFleetModel = (
  deployment: Deployment | undefined,
): { model?: FleetModel } & WatchState => {
  const ns = deployment?.policyNamespace;
  const release = deployment?.release;

  const [labelConfigMaps, labelsLoaded, labelsError] = useWatch<ConfigMapResource[]>(
    ns
      ? {
          groupVersionKind: ConfigMapGVK,
          isList: true,
          namespace: ns,
          selector: existsSelector(SELECTOR_CLUSTER_LABELS),
        }
      : null,
  );

  const [defaultConfigMaps, , defaultsError] = useWatch<ConfigMapResource[]>(
    ns
      ? {
          groupVersionKind: ConfigMapGVK,
          isList: true,
          namespace: ns,
          selector: existsSelector(SELECTOR_DEFAULT_CONFIGS),
        }
      : null,
  );

  const [setConfigMaps, , setConfigsError] = useWatch<ConfigMapResource[]>(
    ns
      ? {
          groupVersionKind: ConfigMapGVK,
          isList: true,
          namespace: ns,
          selector: existsSelector(SELECTOR_CLUSTER_SET_CONFIGS),
        }
      : null,
  );

  const [clusterConfigMaps, , clusterConfigsError] = useWatch<ConfigMapResource[]>(
    ns
      ? {
          groupVersionKind: ConfigMapGVK,
          isList: true,
          namespace: ns,
          selector: existsSelector(SELECTOR_CLUSTER_CONFIGS),
        }
      : null,
  );

  // rendered-config is written back into the policy namespace as <cluster>.rendered-config, not
  // into each managed cluster's own namespace. Scoping the watch keeps two AutoShift deployments
  // on one hub from reading each other's resolved config.
  const [renderedConfigMaps, , renderedError] = useWatch<ConfigMapResource[]>(
    ns
      ? {
          groupVersionKind: ConfigMapGVK,
          isList: true,
          namespace: ns,
          selector: existsSelector(SELECTOR_RENDERED_CONFIG),
        }
      : null,
  );

  const [managedClusters, clustersLoaded, clustersError] = useWatch<ManagedClusterResource[]>({
    groupVersionKind: ManagedClusterGVK,
    isList: true,
  });

  const [applications, , applicationsError] = useWatch<ApplicationResource[]>(
    release
      ? {
          groupVersionKind: ApplicationGVK,
          isList: true,
          selector: { matchLabels: { app: `${release}-policies` } },
        }
      : null,
  );

  const [placements, , placementsError] = useWatch<PlacementResource[]>(
    ns ? { groupVersionKind: PlacementGVK, isList: true, namespace: ns } : null,
  );

  const [placementDecisions, , decisionsError] = useWatch<PlacementDecisionResource[]>(
    ns ? { groupVersionKind: PlacementDecisionGVK, isList: true, namespace: ns } : null,
  );

  const [placementBindings, , bindingsError] = useWatch<PlacementBindingResource[]>(
    ns ? { groupVersionKind: PlacementBindingGVK, isList: true, namespace: ns } : null,
  );

  const [policies, , policiesError] = useWatch<PolicyResource[]>(
    ns ? { groupVersionKind: PolicyGVK, isList: true, namespace: ns } : null,
  );

  const [catalogConfigMap] = useWatch<ConfigMapResource>({
    groupVersionKind: ConfigMapGVK,
    name: CATALOG_CONFIGMAP,
    namespace: CATALOG_NAMESPACE,
  });

  const model = useMemo<FleetModel | undefined>(
    () =>
      deployment
        ? buildFleetModel({
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
          })
        : undefined,
    [
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
    ],
  );

  // Every watch is reported, not just the two the model cannot be built without. A user who can
  // read ConfigMaps but not Placements would otherwise see an empty component list with no hint
  // that it is a permissions boundary rather than an unconfigured fleet.
  const failures = [
    toFailure('cluster label ConfigMaps', labelsError),
    toFailure('default config ConfigMaps', defaultsError),
    toFailure('cluster set config ConfigMaps', setConfigsError),
    toFailure('per-cluster config ConfigMaps', clusterConfigsError),
    toFailure('resolved config ConfigMaps', renderedError),
    toFailure('ManagedClusters', clustersError),
    toFailure('Argo CD Applications', applicationsError),
    toFailure('Placements', placementsError),
    toFailure('PlacementDecisions', decisionsError),
    toFailure('PlacementBindings', bindingsError),
    toFailure('Policies', policiesError),
  ].filter((f): f is WatchFailure => f !== undefined);

  return {
    model,
    loaded: labelsLoaded && clustersLoaded,
    error: labelsError ?? clustersError,
    failures,
  };
};
