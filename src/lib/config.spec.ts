import {
  DELETE_SENTINEL,
  buildProvenance,
  computeLabelDrift,
  flatten,
  formatValue,
  groupLabelFamilies,
  labelState,
  lookupKey,
  mergeDesiredLabels,
  parseJsonKey,
  parseYamlKey,
  shortLabel,
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
    expect(storageClass.stale).toBe(false);
  });

  it('flags a setting whose winning layer disagrees with rendered-config', () => {
    const [retention] = buildProvenance(layers, {
      uwm: { storageClass: 'gp2-csi', retention: '12h' },
    }).filter((p) => p.path === 'uwm.retention');

    expect(retention.stale).toBe(true);
    expect(retention.resolved).toBe('12h');
  });

  it('emits policy-authored paths with no layers and never calls them stale', () => {
    const [authored] = buildProvenance([], { someField: 'set-by-policy' });
    expect(authored.layers).toEqual([]);
    expect(authored.stale).toBe(false);
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

describe('computeLabelDrift', () => {
  it('reports a desired label that was never stamped', () => {
    expect(computeLabelDrift({ 'autoshift.io/acs': 'true' }, {})).toEqual([
      { key: 'autoshift.io/acs', desired: 'true', kind: 'missing' },
    ]);
  });

  it('reports a stamped label that is no longer desired', () => {
    expect(computeLabelDrift({}, { 'autoshift.io/odf': 'true' })).toEqual([
      { key: 'autoshift.io/odf', actual: 'true', kind: 'unexpected' },
    ]);
  });

  it('reports a value mismatch', () => {
    expect(
      computeLabelDrift({ 'autoshift.io/acs': 'true' }, { 'autoshift.io/acs': 'false' }),
    ).toEqual([{ key: 'autoshift.io/acs', desired: 'true', actual: 'false', kind: 'mismatch' }]);
  });

  it('ignores labels AutoShift stamps itself rather than reading from the ConfigMaps', () => {
    expect(
      computeLabelDrift(
        {},
        {
          'autoshift.io/cluster-type': 'hub',
          'autoshift.io/owning-namespace': 'policies-autoshift',
          'autoshift.io/owning-deployment': 'autoshift',
        },
      ),
    ).toEqual([]);
  });

  it('reports nothing when desired and actual agree', () => {
    const labels = { 'autoshift.io/acs': 'true', 'autoshift.io/odf': 'true' };
    expect(computeLabelDrift(labels, labels)).toEqual([]);
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
});
