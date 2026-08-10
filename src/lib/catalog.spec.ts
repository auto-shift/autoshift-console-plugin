import { DEFAULT_STACKS, OTHER_STACK_ID, groupIntoStacks, parseCatalog } from './catalog';
import type { Component } from '../types/autoshift';

const component = (name: string, apiGroups: string[] = []): Component => ({
  name,
  applicationName: `autoshift-${name}`,
  apiGroups,
  gatingLabels: [],
  clusters: [],
  policies: [],
  compliance: { compliant: 0, nonCompliant: 0, pending: 0 },
  checks: [],
});

describe('parseCatalog', () => {
  it('falls back to the built-in catalog when the ConfigMap is absent', () => {
    expect(parseCatalog(undefined)).toBe(DEFAULT_STACKS);
  });

  it('falls back when the override is malformed rather than rendering nothing', () => {
    expect(parseCatalog({ data: { stacks: 'not: [a yaml list' } })).toBe(DEFAULT_STACKS);
    expect(parseCatalog({ data: { stacks: 'stacks: []' } })).toBe(DEFAULT_STACKS);
  });

  it('reads an in-cluster override', () => {
    const cm = {
      data: {
        stacks:
          'stacks:\n  - id: ai\n    name: My AI Stack\n    components:\n      - openshift-ai\n',
      },
    };
    expect(parseCatalog(cm)).toEqual([
      { id: 'ai', name: 'My AI Stack', components: ['openshift-ai'] },
    ]);
  });

  it('skips entries missing an id or components list', () => {
    const cm = {
      data: { stacks: 'stacks:\n  - name: nameless\n  - id: ok\n    components: []\n' },
    };
    expect(parseCatalog(cm)).toEqual([{ id: 'ok', name: 'ok', components: [] }]);
  });
});

describe('groupIntoStacks', () => {
  it('groups discovered components and drops stacks with no members', () => {
    const stacks = groupIntoStacks(
      [component('openshift-ai'), component('gpu-operator')],
      DEFAULT_STACKS,
    );
    expect(stacks).toHaveLength(1);
    expect(stacks[0].id).toBe('ai');
    expect(stacks[0].components.map((c) => c.name)).toEqual(['openshift-ai', 'gpu-operator']);
  });

  it('self-classifies an uncatalogued component by its API group', () => {
    const stacks = groupIntoStacks(
      [component('brand-new-policy', ['widgets.example.io'])],
      DEFAULT_STACKS,
    );
    expect(stacks).toHaveLength(1);
    expect(stacks[0].name).toBe('widgets.example.io');
    expect(stacks[0].id).toBe('group-widgets.example.io');
  });

  it('groups several uncatalogued components sharing an API group together', () => {
    const stacks = groupIntoStacks(
      [
        component('worker-nodes', ['machine.openshift.io']),
        component('infra-nodes', ['machine.openshift.io']),
      ],
      [],
    );
    expect(stacks).toHaveLength(1);
    expect(stacks[0].components.map((c) => c.name)).toEqual(['infra-nodes', 'worker-nodes']);
  });

  it('reaches Other only when a component manages nothing but generic resources', () => {
    const stacks = groupIntoStacks([component('operator-only')], DEFAULT_STACKS);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].id).toBe(OTHER_STACK_ID);
  });

  it('claims a component only once even if two stacks list it', () => {
    const catalog = [
      { id: 'first', name: 'First', components: ['shared'] },
      { id: 'second', name: 'Second', components: ['shared'] },
    ];
    const stacks = groupIntoStacks([component('shared')], catalog);
    expect(stacks.flatMap((s) => s.components)).toHaveLength(2);
    expect(stacks.some((s) => s.id === OTHER_STACK_ID)).toBe(false);
  });
});
