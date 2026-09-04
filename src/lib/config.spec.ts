import {
  DELETE_SENTINEL,
  buildFeatures,
  buildProvenance,
  flatten,
  formatValue,
  groupLabelFamilies,
  labelState,
  lookupKey,
  mergeDesiredLabels,
  parseJsonKey,
  parseYamlKey,
  shortLabel,
  shortRevision,
  toLabelRow,
} from './config';
import type { ConfigLayerInput } from './config';

describe('flatten', () => {
  it('produces dotted leaf paths', () => {
    expect(Array.from(flatten({ uwm: { prometheus: { retention: '24h' } } }))).toEqual([
      ['uwm.prometheus.retention', '24h'],
    ]);
  });

  it('treats arrays as leaves rather than expanding indices', () => {
    const flat = flatten({ certManager: { extraSANs: ['a.example.com', 'b.example.com'] } });
    expect(Array.from(flat.keys())).toEqual(['certManager.extraSANs']);
  });

  it('keeps an empty object as its own leaf so the path is not lost', () => {
    expect(Array.from(flatten({ acs: {} }).keys())).toEqual(['acs']);
  });
});

describe('buildProvenance', () => {
  const layers: ConfigLayerInput[] = [
    { layer: 'default', source: 'default-configs', config: { uwm: { storageClass: 'gp3-csi' } } },
    {
      layer: 'clusterSet',
      source: 'cluster-set-config.hub',
      config: { uwm: { storageClass: 'gp3-csi', retention: '24h' } },
    },
    {
      layer: 'cluster',
      source: 'managed-cluster-config.sandbox',
      config: { uwm: { storageClass: 'gp2-csi' } },
    },
  ];

  it('marks the most specific layer as the winner', () => {
    const [storageClass] = buildProvenance(layers, {
      uwm: { storageClass: 'gp2-csi', retention: '24h' },
    }).filter((p) => p.path === 'uwm.storageClass');

    expect(storageClass.layers.map((l) => [l.layer, l.value, l.wins])).toEqual([
      ['default', 'gp3-csi', false],
      ['clusterSet', 'gp3-csi', false],
      ['cluster', 'gp2-csi', true],
    ]);
    expect(storageClass.resolved).toBe('gp2-csi');
  });

  it('reports the value rendered-config actually resolved to', () => {
    const [retention] = buildProvenance(layers, {
      uwm: { storageClass: 'gp2-csi', retention: '12h' },
    }).filter((p) => p.path === 'uwm.retention');

    expect(retention.resolved).toBe('12h');
  });

  it('emits policy-authored paths with no layers', () => {
    const [authored] = buildProvenance([], { someField: 'set-by-policy' });
    expect(authored.layers).toEqual([]);
    expect(authored.resolved).toBe('set-by-policy');
  });
});

describe('mergeDesiredLabels', () => {
  it('lets the per-cluster override win over the cluster set', () => {
    expect(
      mergeDesiredLabels({ 'autoshift.io/acs': 'true' }, { 'autoshift.io/acs': 'false' }),
    ).toEqual({ 'autoshift.io/acs': 'false' });
  });

  it('drops labels marked with the delete sentinel', () => {
    expect(
      mergeDesiredLabels(
        { 'autoshift.io/acs': 'true', 'autoshift.io/odf': 'true' },
        { 'autoshift.io/acs': DELETE_SENTINEL },
      ),
    ).toEqual({ 'autoshift.io/odf': 'true' });
  });
});

describe('ConfigMap parsing', () => {
  it('parses the JSON layers AutoShift writes with toJson', () => {
    expect(parseJsonKey({ data: { config: '{"uwm":{"retention":"24h"}}' } }, 'config')).toEqual({
      uwm: { retention: '24h' },
    });
  });

  it('parses the YAML rendered-config AutoShift writes with toYaml', () => {
    expect(parseYamlKey({ data: { config: 'uwm:\n  retention: 24h\n' } }, 'config')).toEqual({
      uwm: { retention: '24h' },
    });
  });

  it('returns an empty object for missing or malformed data rather than throwing', () => {
    expect(parseJsonKey(undefined, 'config')).toEqual({});
    expect(parseJsonKey({ data: { config: 'not json' } }, 'config')).toEqual({});
    expect(parseYamlKey({ data: { config: '\t- [unbalanced' } }, 'config')).toEqual({});
  });
});

describe('groupLabelFamilies', () => {
  it('nests a setting under the feature it belongs to', () => {
    const families = groupLabelFamilies(
      {
        'autoshift.io/acs': 'true',
        'autoshift.io/acs-monitoring': 'true',
        'autoshift.io/acs-channel': 'stable',
      },
      ['acs'],
    );
    expect(families).toHaveLength(1);
    expect(families[0].name).toBe('acs');
    expect(families[0].value).toBe('true');
    expect(families[0].settings.map((s) => s.key)).toEqual(['acs-channel', 'acs-monitoring']);
  });

  /*
   * A feature whose only label is its own on/off switch has no settings to list. The Labels view
   * in ClusterSetsPage does not repeat that switch — the row it expands from already carries a
   * State column — so an empty settings list is what makes it render an empty state rather than
   * a table with nothing in it. Two of the 39 features in the captured live fixture are this
   * shape, so it is the ordinary case for a feature that takes no configuration, not an edge one.
   */
  it('leaves a toggle-only feature with no settings to list', () => {
    const families = groupLabelFamilies({ 'autoshift.io/acs': 'true' }, ['acs']);
    expect(families).toHaveLength(1);
    expect(families[0].value).toBe('true');
    expect(families[0].settings).toEqual([]);
  });

  it('groups at the root so an intermediate key never renders twice', () => {
    const families = groupLabelFamilies({
      'autoshift.io/gitops': 'true',
      'autoshift.io/gitops-dev': 'true',
      'autoshift.io/gitops-dev-team-test': 'true',
    });
    expect(families.map((f) => f.name)).toEqual(['gitops']);
    expect(families[0].settings.map((s) => s.key)).toEqual(['gitops-dev', 'gitops-dev-team-test']);
  });

  it('forms a synthetic group when several labels share a token but no bare label exists', () => {
    const families = groupLabelFamilies({
      'autoshift.io/acm-observability': 'true',
      'autoshift.io/acm-search-storage': 'true',
    });
    expect(families.map((f) => f.name)).toEqual(['acm']);
    expect(families[0].value).toBeUndefined();
    expect(families[0].settings).toHaveLength(2);
  });

  it('keeps a lone hyphenated label as its own feature', () => {
    const families = groupLabelFamilies({ 'autoshift.io/cluster-install': 'true' });
    expect(families).toEqual([{ name: 'cluster-install', value: 'true', settings: [] }]);
  });

  it('sorts features that are on to the top', () => {
    const families = groupLabelFamilies({
      'autoshift.io/zzz': 'true',
      'autoshift.io/aaa': 'false',
    });
    expect(families.map((f) => f.name)).toEqual(['zzz', 'aaa']);
  });
});

describe('labelState', () => {
  it('reads a plain boolean the obvious way', () => {
    expect(labelState('acs', 'true')).toBe('on');
    expect(labelState('acs', 'false')).toBe('off');
  });

  it('inverts a -disabled label so true does not read as enabled', () => {
    expect(labelState('aap-lightspeed-disabled', 'true')).toBe('off');
    expect(labelState('aap-lightspeed-disabled', 'false')).toBe('on');
  });

  it('treats a non-boolean as a plain value', () => {
    expect(labelState('acs-channel', 'stable')).toBe('value');
    expect(labelState('acs-channel', '')).toBe('value');
    expect(labelState('acs-channel', undefined)).toBe('value');
  });
});

describe('display helpers', () => {
  it('strips the autoshift.io prefix', () => {
    expect(shortLabel('autoshift.io/acs')).toBe('acs');
    expect(shortLabel('other/label')).toBe('other/label');
  });

  it('distinguishes an unset value from an empty string', () => {
    expect(formatValue(undefined)).toBe('—');
    expect(formatValue('')).toBe("''");
    expect(formatValue(false)).toBe('false');
    expect(formatValue(null)).toBe('null');
  });

  it('reads optional keys without inventing values', () => {
    expect(lookupKey({ a: 'x' }, 'a')).toBe('x');
    expect(lookupKey({ a: 'x' }, 'b')).toBeUndefined();
  });

  it('abbreviates a git sha but leaves other revisions whole', () => {
    expect(shortRevision('0123456789abcdef0123456789abcdef01234567')).toBe('0123456');
    expect(shortRevision('sha256:abcdef')).toBe('sha256:abcdef');
    expect(shortRevision('v1.2.3')).toBe('v1.2.3');
    expect(shortRevision(undefined)).toBeUndefined();
  });
});

describe('toLabelRow', () => {
  it('drops the feature prefix and normalises separators', () => {
    expect(toLabelRow('aap', 'aap-file_storage_size', '20Gi')).toEqual({
      key: 'aap-file_storage_size',
      value: '20Gi',
      display: 'File storage size',
      concern: 'storage',
    });
  });

  // The double negative the raw key forces on the reader: aap-hub-disabled: on means the hub IS
  // disabled. Name and value are inverted together, so the row reads "Hub / off".
  it('states the effective thing for a -disabled label', () => {
    const row = toLabelRow('aap', 'aap-hub-disabled', 'true');
    expect(row.display).toBe('Hub');
    expect(labelState(row.key, row.value)).toBe('off');
  });

  it('keeps the feature name when the whole label is the toggle', () => {
    expect(toLabelRow('aap', 'aap', 'true').display).toBe('Aap');
    expect(toLabelRow('aap', 'aap-disabled', 'true').display).toBe('Aap');
  });

  it('sorts labels into the concern they speak to', () => {
    expect(toLabelRow('acs', 'acs-channel', 'stable').concern).toBe('source');
    expect(toLabelRow('acs', 'acs-source-namespace', 'openshift-marketplace').concern).toBe(
      'source',
    );
    expect(toLabelRow('aap', 'aap-file-storage_storage_class', 'gp3').concern).toBe('storage');
    expect(toLabelRow('aap', 'aap-eda-disabled', 'true').concern).toBe('toggle');
    expect(toLabelRow('aap', 'aap-controller-replicas', '3').concern).toBe('setting');
  });
});

describe('buildFeatures', () => {
  const component = (name: string, gatingLabels: string[]) => ({
    name,
    gatingLabels,
    clusters: [],
    policies: [],
  });

  /*
   * The bug this pins: a cluster set declares only the labels it OVERRIDES. A component gating on
   * autoshift.io/acm-observability is still an acm component when the set leaves observability at
   * its policy default, so requiring the set to declare that exact key left the acm feature
   * reporting no consumers at all on a minimal profile.
   */
  it('joins a component whose gating label the set leaves at its default', () => {
    const features = buildFeatures(
      {
        'autoshift.io/acm-channel': 'release-2.17',
        'autoshift.io/acm-source': 'redhat-operators',
      },
      {},
      [component('advanced-cluster-management', ['autoshift.io/acm-observability'])],
    );

    expect(features.find((f) => f.name === 'acm')?.components.map((c) => c.name)).toEqual([
      'advanced-cluster-management',
    ]);
  });

  it('gives the gating label to one feature, not to every feature it could prefix', () => {
    const features = buildFeatures({ 'autoshift.io/acs': 'true', 'autoshift.io/odf': 'true' }, {}, [
      component('odf-thing', ['autoshift.io/odf-csi-all-nodes']),
    ]);

    expect(features.find((f) => f.name === 'acs')?.components).toEqual([]);
    expect(features.find((f) => f.name === 'odf')?.components.map((c) => c.name)).toEqual([
      'odf-thing',
    ]);
  });
});
