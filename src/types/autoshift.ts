import type { K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';

/** A ConfigMap as AutoShift writes it — data keys vary by which selector matched. */
export type ConfigMapResource = K8sResourceCommon & {
  data?: Record<string, string>;
};

export type ManagedClusterResource = K8sResourceCommon & {
  status?: {
    conditions?: { type: string; status: string; reason?: string; message?: string }[];
    version?: { kubernetes?: string };
    clusterClaims?: { name: string; value: string }[];
  };
};

export type PlacementResource = K8sResourceCommon & {
  spec?: {
    predicates?: {
      requiredClusterSelector?: {
        labelSelector?: {
          matchExpressions?: { key: string; operator: string; values?: string[] }[];
          matchLabels?: Record<string, string>;
        };
      };
    }[];
  };
};

export type PlacementDecisionResource = K8sResourceCommon & {
  status?: { decisions?: { clusterName: string; reason?: string }[] };
};

export type PlacementBindingResource = K8sResourceCommon & {
  placementRef?: { name: string; kind: string; apiGroup?: string };
  subjects?: { name: string; kind: string; apiGroup?: string }[];
};

export type PolicyResource = K8sResourceCommon & {
  spec?: { disabled?: boolean; remediationAction?: string };
  status?: {
    compliant?: string;
    status?: { clustername: string; clusternamespace?: string; compliant?: string }[];
  };
};

export type ApplicationResource = K8sResourceCommon & {
  spec?: {
    source?: { targetRevision?: string; repoURL?: string; chart?: string; path?: string };
    sources?: { targetRevision?: string; repoURL?: string; chart?: string; path?: string }[];
  };
  status?: {
    sync?: { status?: string; revision?: string };
    health?: { status?: string; message?: string };
  };
};

/** One AutoShift deployment on this hub. Several may coexist during a gradual rollout. */
export interface Deployment {
  /** ArgoCD release name, e.g. "autoshift" or "autoshift-0-0-1". */
  release: string;
  /** Namespace holding the deployment's policies, e.g. "policies-autoshift". */
  policyNamespace: string;
  /** targetRevision from the deployment's Applications — git branch/tag or OCI version. */
  version?: string;
}

/** Which layer a resolved value came from. Ordered least to most specific. */
export type LayerName = 'default' | 'clusterSet' | 'cluster';

export const LAYER_ORDER: LayerName[] = ['default', 'clusterSet', 'cluster'];

export interface LayerValue {
  layer: LayerName;
  /** Object the layer came from, e.g. "cluster-set-config.hub". */
  source: string;
  value: unknown;
  /** True for the most specific layer that defines this path. */
  wins: boolean;
}

/** The derivation of a single leaf setting across the config layers. */
export interface Provenance {
  /** Dotted leaf path, e.g. "uwm.prometheus.retention". */
  path: string;
  layers: LayerValue[];
  /** Value in the cluster's rendered-config, i.e. what AutoShift actually resolved. */
  resolved: unknown;
}

/** One policy's verdict on one cluster — the granularity ACM actually reports. */
export interface PolicyCheck {
  policy: string;
  cluster: string;
  /** Compliant | NonCompliant | Pending, or absent when ACM has not reported yet. */
  compliant?: string;
}

export interface ComplianceCounts {
  compliant: number;
  nonCompliant: number;
  pending: number;
}

/** A policy directory AutoShift deploys, discovered from its ArgoCD Application. */
export interface Component {
  /** Policy directory name, e.g. "openshift-ai". */
  name: string;
  /** ArgoCD Application name, e.g. "autoshift-openshift-ai". */
  applicationName: string;
  /** Support tier from the source path (policies/<tier>/<name>): stable, certified, community. */
  tier?: string;
  /** API groups this component's policies manage, most-used first. Empty for operator-only installs. */
  apiGroups: string[];
  syncStatus?: string;
  healthStatus?: string;
  /** autoshift.io/<key> the component's Placement gates on, when it has one. */
  gatingLabels: string[];
  /** Clusters the Placement currently selects. */
  clusters: string[];
  policies: string[];
  compliance: ComplianceCounts;
  /** Per-policy, per-cluster verdicts, so a failure can be traced to a specific cluster. */
  checks: PolicyCheck[];
}

export interface Stack {
  id: string;
  name: string;
  components: Component[];
}

export interface ClusterView {
  name: string;
  clusterSet?: string;
  clusterType?: string;
  selfManaged: boolean;
  owningNamespace?: string;
  /** autoshift.io/owning-deployment — which AutoShift release manages this cluster. */
  owningDeployment?: string;
  available: boolean;
  /** Desired OCP version from the autoshift.io/openshift-version label. */
  desiredVersion?: string;
  /** Reported kubernetes version from ManagedCluster status. */
  kubernetesVersion?: string;
  /** Reported OpenShift version from the openshiftVersion ClusterClaim. */
  openshiftVersion?: string;
  /** Merged clusterset + per-cluster labels from the ConfigMaps, i.e. what the values files ask for. */
  desiredLabels: Record<string, string>;
  /** autoshift.io/* labels stamped on the ManagedCluster — the effective values. */
  actualLabels: Record<string, string>;
  /**
   * Desired OCP version differs from what the cluster reports. Unlike labels and config, this is
   * not policy-reconciled on a short interval: an upgrade takes hours, so the gap is real state.
   */
  upgradePending: boolean;
  resolvedConfig: Record<string, unknown>;
  provenance: Provenance[];
  compliance: ComplianceCounts;
  /** Every policy verdict for this cluster, for the compliance detail view. */
  checks: PolicyCheck[];
}

/** A feature label plus the settings that hang off it, e.g. acs and acs-monitoring. */
export interface LabelFamily {
  /** Short name with the autoshift.io/ prefix stripped, e.g. "acs". */
  name: string;
  /** Value of the bare toggle, when the family has one. */
  value?: string;
  settings: { key: string; value: string }[];
}

/**
 * A feature: its label family joined to the config block it owns and the components that deliver
 * it. All three are matched at runtime from live objects — nothing comes from a build-time
 * manifest, so a feature AutoShift adds later still assembles correctly.
 */
export interface FeatureView extends LabelFamily {
  /** Top-level config key this feature owns, when one matches its name. */
  configKey?: string;
  /** The config subtree under configKey, flattened to dotted leaf paths. */
  config: { path: string; value: unknown }[];
  /** Components whose Placement gates on a label in this family. */
  components: {
    name: string;
    /** Clusters the component's Placement currently selects, by name. */
    clusters: string[];
    syncStatus?: string;
    healthStatus?: string;
    /** The component's policies, so a feature can be traced through to ACM Governance. */
    policies: string[];
  }[];
}

export interface ClusterSetView {
  name: string;
  labels: Record<string, string>;
  config: Record<string, unknown>;
  clusters: string[];
  /** Enabled autoshift.io/<key> labels whose value is "true". */
  enabled: string[];
  /** Labels grouped into features, joined to their config and delivering components. */
  features: FeatureView[];
}

export interface FleetModel {
  deployment: Deployment;
  clusters: ClusterView[];
  clusterSets: ClusterSetView[];
  components: Component[];
  stacks: Stack[];
}
