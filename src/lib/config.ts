import { load } from 'js-yaml';
import { AUTOSHIFT_LABEL_PREFIX } from '../k8s/models';
import { LAYER_ORDER } from '../types/autoshift';
import type {
  ConfigMapResource,
  FeatureView,
  LabelFamily,
  LayerName,
  LayerValue,
  Provenance,
} from '../types/autoshift';

/**
 * AutoShift writes an empty label value as "_" in the generated ConfigMaps. The cluster-labels
 * policy treats it as "remove this label", so it must never surface as a desired value.
 */
export const DELETE_SENTINEL = '_';

export type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parse a JSON-encoded ConfigMap data key. AutoShift writes these with `toJson`. */
export const parseJsonKey = (cm: ConfigMapResource | undefined, key: string): PlainObject => {
  const raw = cm?.data?.[key];
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

/** Parse a YAML-encoded ConfigMap data key. rendered-config is written with `toYaml`. */
export const parseYamlKey = (cm: ConfigMapResource | undefined, key: string): PlainObject => {
  const raw = cm?.data?.[key];
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = load(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

/** Read a string map, dropping non-string values defensively. */
export const asStringMap = (value: PlainObject): Record<string, string> => {
  const out: Record<string, string> = {};
  Object.entries(value).forEach(([k, v]) => {
    if (typeof v === 'string') {
      out[k] = v;
    }
  });
  return out;
};

/**
 * Flatten nested config to dotted leaf paths. Arrays are treated as leaves — comparing them
 * element-wise produces noisy per-index rows that say nothing useful about which layer won.
 */
export const flatten = (obj: PlainObject, prefix = ''): Map<string, unknown> => {
  const out = new Map<string, unknown>();
  Object.entries(obj).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      const nested = flatten(value, path);
      if (nested.size === 0) {
        out.set(path, value);
      } else {
        nested.forEach((v, k) => out.set(k, v));
      }
    } else {
      out.set(path, value);
    }
  });
  return out;
};

export interface ConfigLayerInput {
  layer: LayerName;
  /** Name of the object the layer came from, shown in the UI. */
  source: string;
  config: PlainObject;
}

/**
 * Build the derivation of every setting across the config layers.
 *
 * The winning layer is the most specific one that defines a path — matching how the
 * cluster-config-maps policy merges default -> clusterset -> cluster into rendered-config. Paths
 * present only in rendered-config are still emitted (with no layers) so nothing is hidden.
 */
export const buildProvenance = (
  layers: ConfigLayerInput[],
  resolved: PlainObject,
): Provenance[] => {
  const flatLayers = layers.map((l) => ({ ...l, flat: flatten(l.config) }));
  const flatResolved = flatten(resolved);

  const paths = new Set<string>();
  flatLayers.forEach((l) => {
    l.flat.forEach((_v, k) => paths.add(k));
  });
  flatResolved.forEach((_v, k) => paths.add(k));

  const rank = (layer: LayerName): number => LAYER_ORDER.indexOf(layer);

  return Array.from(paths)
    .sort((a, b) => a.localeCompare(b))
    .map((path) => {
      const present = flatLayers
        .filter((l) => l.flat.has(path))
        .sort((a, b) => rank(a.layer) - rank(b.layer));

      const winnerIndex = present.length - 1;
      const entries: LayerValue[] = present.map((l, i) => ({
        layer: l.layer,
        source: l.source,
        value: l.flat.get(path),
        wins: i === winnerIndex,
      }));

      return { path, layers: entries, resolved: flatResolved.get(path) };
    });
};

/**
 * Merge desired labels the way the cluster-labels policy does: clusterset first, then the
 * per-cluster override, then drop anything marked with the delete sentinel.
 */
export const mergeDesiredLabels = (
  clusterSetLabels: Record<string, string>,
  clusterLabels: Record<string, string>,
): Record<string, string> => {
  const merged: Record<string, string> = { ...clusterSetLabels, ...clusterLabels };
  const out: Record<string, string> = {};
  Object.entries(merged).forEach(([k, v]) => {
    if (v !== DELETE_SENTINEL) {
      out[k] = v;
    }
  });
  return out;
};

/** Keep only autoshift.io/* labels — the only ones cluster-labels manages. */
export const autoshiftLabels = (labels: Record<string, string> = {}): Record<string, string> => {
  const out: Record<string, string> = {};
  Object.entries(labels).forEach(([k, v]) => {
    if (k.startsWith(AUTOSHIFT_LABEL_PREFIX)) {
      out[k] = v;
    }
  });
  return out;
};

/**
 * Labels AutoShift stamps itself, which by design never appear in the desired-label ConfigMaps:
 *
 *   cluster-type       injected by the top-level chart at Helm render time
 *   owning-namespace   written by cluster-labels from whichever cluster-set.* ConfigMap matched
 *   owning-deployment  the same, with the policies- prefix stripped
 *
 * Marked in the labels view so their absence from the values files does not read as an anomaly.
 */
export const AUTO_STAMPED_LABELS = new Set([
  `${AUTOSHIFT_LABEL_PREFIX}cluster-type`,
  `${AUTOSHIFT_LABEL_PREFIX}owning-namespace`,
  `${AUTOSHIFT_LABEL_PREFIX}owning-deployment`,
]);

/**
 * Group labels into features.
 *
 * Group names are NOT guessed from string prefixes — that produced overlapping junk groups (`cert`
 * beside `cert-manager`, `worker` beside `worker-nodes`). Instead the cluster supplies the
 * vocabulary: every Placement gating label plus every component name. A label joins the SHORTEST
 * known name that prefixes it, so `cert-manager-ca` and `cert-manager-ingress-cert` both land under
 * `cert-manager`, while `node-feature-discovery` and `node-maintenance` stay correctly apart.
 *
 * A label matching no known name (`acm-source`, `openshift-version`) falls back to its leading
 * token, and if that token also prefixes existing groups they are absorbed into it — otherwise
 * `acm-source` would sit beside `acm-observability` instead of with it. A token shared by nothing
 * else leaves the label as its own single-entry feature.
 */
export const groupLabelFamilies = (
  labels: Record<string, string>,
  vocabulary: Iterable<string> = [],
): LabelFamily[] => {
  const shortKeys = Object.keys(labels).map(shortLabel);
  const vocab = Array.from(new Set(vocabulary));

  const knownName = (key: string): string | undefined => {
    let best: string | undefined;
    vocab.forEach((name) => {
      if (key === name || key.startsWith(`${name}-`)) {
        if (best === undefined || name.length < best.length) {
          best = name;
        }
      }
    });
    return best;
  };

  const assigned = new Map<string, string>();
  const leftover: string[] = [];
  shortKeys.forEach((key) => {
    const name = knownName(key);
    if (name === undefined) {
      leftover.push(key);
    } else {
      assigned.set(key, name);
    }
  });

  const leadingToken = (key: string): string => key.split('-')[0] ?? key;
  const rename = new Map<string, string>();

  new Set(leftover.map(leadingToken)).forEach((token) => {
    const hits = Array.from(new Set(assigned.values())).filter(
      (name) => name === token || name.startsWith(`${token}-`),
    );
    const mates = leftover.filter((key) => leadingToken(key) === token);
    if (hits.length > 0 || mates.length > 1) {
      hits.forEach((name) => rename.set(name, token));
      mates.forEach((key) => assigned.set(key, token));
    } else {
      mates.forEach((key) => assigned.set(key, key));
    }
  });

  assigned.forEach((name, key) => {
    const merged = rename.get(name);
    if (merged !== undefined) {
      assigned.set(key, merged);
    }
  });

  const families = new Map<string, LabelFamily>();
  Array.from(assigned.keys())
    .sort((a, b) => a.localeCompare(b))
    .forEach((key) => {
      const name = assigned.get(key) ?? key;
      const value =
        lookupKey(labels, `${AUTOSHIFT_LABEL_PREFIX}${key}`) ?? lookupKey(labels, key) ?? '';
      const family = families.get(name) ?? { name, settings: [] };
      if (key === name) {
        family.value = value;
      } else {
        family.settings.push({ key, value });
      }
      families.set(name, family);
    });

  return Array.from(families.values()).sort((a, b) => {
    // Features that are on float to the top; that is what someone scanning a set wants first.
    const aOn = a.value === 'true' ? 0 : 1;
    const bOn = b.value === 'true' ? 0 : 1;
    return aOn !== bOn ? aOn - bOn : a.name.localeCompare(b.name);
  });
};

/**
 * Normalise a name for joining across AutoShift's three naming styles: labels are kebab-case
 * (`cert-manager`), config keys are camelCase (`certManager`). Comparing on letters and digits
 * alone links them without a lookup table.
 */
export const normaliseName = (name: string): string =>
  name.replace(/[^a-z0-9]/gi, '').toLowerCase();

/**
 * A label ending in -disabled inverts its meaning: `true` turns something off. Rendering it as a
 * green "enabled" chip is actively wrong, so state is derived rather than read straight off value.
 */
export const labelState = (name: string, value: string | undefined): 'on' | 'off' | 'value' => {
  if (value === undefined || value === '') {
    return 'value';
  }
  const inverted = name.endsWith('-disabled');
  if (value === 'true') {
    return inverted ? 'off' : 'on';
  }
  if (value === 'false') {
    return inverted ? 'on' : 'off';
  }
  return 'value';
};

/**
 * Which concern a label speaks to. Used to group a feature's labels rather than printing them in
 * one alphabetical run, where `aap-channel` sits next to `aap-controller-replicas` and the reader
 * has to sort the list themselves.
 */
export type LabelConcern = 'toggle' | 'source' | 'storage' | 'setting';

/** Where the operator/chart comes from: catalog, channel, version, image. */
const SOURCE_TOKENS =
  /(^|[-_])(channel|source|version|subscription|catalog|image|repo|tag)([-_]|$)/;

/** Persistence: size, class, retention. */
const STORAGE_TOKENS = /(^|[-_])(storage|pvc|volume|size|capacity|retention)([-_]|$)/;

export const labelConcern = (key: string, value: string | undefined): LabelConcern => {
  if (labelState(key, value) !== 'value') {
    return 'toggle';
  }
  if (SOURCE_TOKENS.test(key)) {
    return 'source';
  }
  if (STORAGE_TOKENS.test(key)) {
    return 'storage';
  }
  return 'setting';
};

/** Reading order for the concern groups: state first, then where it comes from, then how it is sized. */
export const LABEL_CONCERN_ORDER: LabelConcern[] = ['toggle', 'source', 'storage', 'setting'];

export interface LabelRow {
  /** The label exactly as AutoShift writes it, e.g. "aap-file_storage_size". */
  key: string;
  value: string;
  /** Human-facing name, e.g. "File storage size". */
  display: string;
  concern: LabelConcern;
}

/**
 * Turn one label into a display row.
 *
 * Two things are normalised, neither of which changes the underlying label:
 *
 *   - the feature prefix is dropped, because the feature name is already the heading above
 *   - a trailing `-disabled` is dropped, because `aap-hub-disabled: on` states the negative of what
 *     it means. The value chip inverts alongside it (labelState already does this), so the pair
 *     reads "Hub / off" instead of asking the reader to invert twice.
 *
 * Hyphens and underscores both become spaces: AutoShift's own keys mix the two within one feature
 * (`aap-file_storage_size` beside `aap-file-storage_storage_class`), and that inconsistency is not
 * information. The raw key is kept on the row so it stays copyable for editing values files.
 */
export const toLabelRow = (feature: string, key: string, value: string): LabelRow => {
  let display = key === feature ? feature : (nameWithoutPrefix(key, `${feature}-`) ?? key);
  if (display.endsWith('-disabled')) {
    display = display.slice(0, -'-disabled'.length);
  } else if (display === 'disabled') {
    display = feature;
  }
  display = display.replace(/[-_]/g, ' ');
  return {
    key,
    value,
    display: display.charAt(0).toUpperCase() + display.slice(1),
    concern: labelConcern(key, value),
  };
};

const nameWithoutPrefix = (name: string, prefix: string): string | undefined =>
  name.startsWith(prefix) ? name.slice(prefix.length) : undefined;

/**
 * API groups that say nothing about what a component is *for*. Every AutoShift policy is wrapped
 * in policy.open-cluster-management.io and most install through operators.coreos.com, so counting
 * them would put everything in one bucket.
 */
const GENERIC_API_GROUPS = new Set([
  'policy.open-cluster-management.io',
  'operators.coreos.com',
  'rbac.authorization.k8s.io',
  'console.openshift.io',
  'batch',
  'apps',
]);

const API_VERSION_IN_TEMPLATE = /apiVersion:\s*["']?([a-z0-9.-]+)\//g;

/**
 * The API groups a component actually manages, most-used first.
 *
 * This is what lets a component classify itself: `cluster-set-assignment` manages
 * `cluster.open-cluster-management.io`, `openshift-upgrade` manages `config.openshift.io`, the
 * four node policies all manage `machine.openshift.io`. Resources appear either as structured
 * objectDefinitions or inside an `object-templates-raw` Go-template string, so both are scanned.
 *
 * Empty for a component that only installs an operator and configures nothing — a real outcome,
 * not a parse failure.
 */
export const managedApiGroups = (policySpecs: unknown[]): string[] => {
  const counts = new Map<string, number>();

  const bump = (group: string): void => {
    if (!GENERIC_API_GROUPS.has(group)) {
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
  };

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || node === null) {
      return;
    }
    Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
      if (key === 'object-templates-raw' && typeof value === 'string') {
        const re = new RegExp(API_VERSION_IN_TEMPLATE.source, 'g');
        let match = re.exec(value);
        while (match !== null) {
          bump(match[1]);
          match = re.exec(value);
        }
      } else if (key === 'apiVersion' && typeof value === 'string' && value.includes('/')) {
        bump(value.split('/')[0]);
      } else {
        walk(value);
      }
    });
  };

  policySpecs.forEach(walk);

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([group]) => group);
};

/** The component fields buildFeatures needs; keeps it decoupled from the full Component type. */
export interface FeatureComponentInput {
  name: string;
  gatingLabels: string[];
  clusters: string[];
  syncStatus?: string;
  healthStatus?: string;
  policies: string[];
}

/**
 * Join a label family to the config block it owns and the components that deliver it.
 *
 * The three sides are linked entirely at runtime:
 *   - labels    grouped by shared prefix
 *   - config    top-level key whose normalised name matches the family (cert-manager -> certManager)
 *   - component its Placement gates on one of the family's labels
 *
 * So a feature AutoShift adds later assembles here with no plugin change. A family with no config
 * block or no component is normal — plenty of labels are pure toggles.
 */
export const buildFeatures = (
  labels: Record<string, string>,
  config: PlainObject,
  components: FeatureComponentInput[],
): FeatureView[] => {
  const configKeys = new Map(Object.keys(config).map((k) => [normaliseName(k), k]));

  // The cluster's own vocabulary for what a feature is called.
  const vocabulary = components.flatMap((c) => [c.name, ...c.gatingLabels.map(shortLabel)]);

  return groupLabelFamilies(labels, vocabulary).map((family) => {
    const memberKeys = new Set([family.name, ...family.settings.map((s) => s.key)]);

    const configKey = configKeys.get(normaliseName(family.name));
    const subtree = configKey === undefined ? undefined : config[configKey];
    const flatConfig =
      subtree === undefined
        ? []
        : isPlainObject(subtree)
          ? Array.from(flatten(subtree)).map(([path, value]) => ({ path, value }))
          : [{ path: configKey ?? family.name, value: subtree }];

    const owned = components.filter((c) =>
      c.gatingLabels.some((g) => memberKeys.has(shortLabel(g))),
    );

    return {
      ...family,
      configKey,
      config: flatConfig,
      components: owned.map((c) => ({
        name: c.name,
        clusters: c.clusters,
        syncStatus: c.syncStatus,
        healthStatus: c.healthStatus,
        policies: c.policies,
      })),
    };
  });
};

/**
 * Read an optional key from a string map. A Record index signature types every read as defined,
 * so a plain `labels[key]` can never be narrowed against undefined.
 */
export const lookupKey = (map: Record<string, string>, key: string): string | undefined =>
  Object.hasOwn(map, key) ? map[key] : undefined;

/** Strip the autoshift.io/ prefix for display. */
export const shortLabel = (key: string): string =>
  key.startsWith(AUTOSHIFT_LABEL_PREFIX) ? key.slice(AUTOSHIFT_LABEL_PREFIX.length) : key;

/**
 * Shorten a resolved Argo CD revision for display.
 *
 * A git commit is abbreviated the way git itself does; anything else — an OCI digest, a chart
 * version — is left alone, because truncating those loses the identifier rather than shortening it.
 */
export const shortRevision = (revision: string | undefined): string | undefined => {
  if (!revision) {
    return undefined;
  }
  return /^[0-9a-f]{40}$/.test(revision) ? revision.slice(0, 7) : revision;
};

/** Render an arbitrary config value for a table cell. */
export const formatValue = (value: unknown): string => {
  if (value === undefined) {
    return '—';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return value === '' ? "''" : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
};
