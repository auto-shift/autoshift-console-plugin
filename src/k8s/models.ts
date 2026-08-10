import type { K8sGroupVersionKind } from '@openshift-console/dynamic-plugin-sdk';

/**
 * Every object the plugin reads already exists on an AutoShift hub. Nothing here is created,
 * patched or deleted — reads go through the console's k8s proxy under the viewer's own RBAC.
 */

export const ConfigMapGVK: K8sGroupVersionKind = { version: 'v1', kind: 'ConfigMap' };

export const ManagedClusterGVK: K8sGroupVersionKind = {
  group: 'cluster.open-cluster-management.io',
  version: 'v1',
  kind: 'ManagedCluster',
};

export const ManagedClusterSetGVK: K8sGroupVersionKind = {
  group: 'cluster.open-cluster-management.io',
  version: 'v1beta2',
  kind: 'ManagedClusterSet',
};

export const PlacementGVK: K8sGroupVersionKind = {
  group: 'cluster.open-cluster-management.io',
  version: 'v1beta1',
  kind: 'Placement',
};

export const PlacementDecisionGVK: K8sGroupVersionKind = {
  group: 'cluster.open-cluster-management.io',
  version: 'v1beta1',
  kind: 'PlacementDecision',
};

export const PlacementBindingGVK: K8sGroupVersionKind = {
  group: 'policy.open-cluster-management.io',
  version: 'v1',
  kind: 'PlacementBinding',
};

export const PolicyGVK: K8sGroupVersionKind = {
  group: 'policy.open-cluster-management.io',
  version: 'v1',
  kind: 'Policy',
};

export const ApplicationGVK: K8sGroupVersionKind = {
  group: 'argoproj.io',
  version: 'v1alpha1',
  kind: 'Application',
};

/** Label selectors AutoShift stamps on the ConfigMaps that carry its desired state. */
export const SELECTOR_CLUSTER_LABELS = 'autoshift.io/cluster-labels';
export const SELECTOR_DEFAULT_CONFIGS = 'autoshift.io/cluster-default-configs';
export const SELECTOR_CLUSTER_SET_CONFIGS = 'autoshift.io/cluster-set-configs';
export const SELECTOR_CLUSTER_CONFIGS = 'autoshift.io/cluster-configs';
export const SELECTOR_RENDERED_CONFIG = 'autoshift.io/rendered-config-map';

/** ConfigMap name prefixes, stripped to recover the clusterset / cluster the object describes. */
export const PREFIX_CLUSTER_SET = 'cluster-set.';
export const PREFIX_MANAGED_CLUSTER = 'managed-cluster.';
export const PREFIX_CLUSTER_SET_CONFIG = 'cluster-set-config.';
export const PREFIX_MANAGED_CLUSTER_CONFIG = 'managed-cluster-config.';
export const SUFFIX_RENDERED_CONFIG = '.rendered-config';

export const AUTOSHIFT_LABEL_PREFIX = 'autoshift.io/';
export const CLUSTERSET_LABEL = 'cluster.open-cluster-management.io/clusterset';
export const PLACEMENT_LABEL = 'cluster.open-cluster-management.io/placement';

/** Namespace that holds an AutoShift deployment's policies, e.g. policies-autoshift. */
export const POLICY_NAMESPACE_PREFIX = 'policies-';
