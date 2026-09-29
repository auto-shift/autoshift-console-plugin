import { useState } from 'react';
import {
  EmptyState,
  EmptyStateBody,
  Label,
  LabelGroup,
  SearchInput,
  Split,
  SplitItem,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useTranslation } from 'react-i18next';
import type { FC } from 'react';
import type { Component } from '../types/autoshift';
import { PageFrame } from './common/PageFrame';
import { ArgoLabel, ComplianceLabel } from './common/status';
import { shortLabel } from '../lib/config';
import { ComplianceDetail } from './common/ComplianceDetail';

import './autoshift.css';

/**
 * Tier is a maturity signal, so the colours run in that order rather than being merely distinct:
 * green for supported, blue for certified-but-not-ours, orange for community. An unknown tier is
 * grey — that is missing information, not a fourth level of risk.
 */
const TIER_COLOURS: Record<string, 'green' | 'blue' | 'orange' | 'grey'> = {
  stable: 'green',
  certified: 'blue',
  community: 'orange',
};

/** Maturity order for the tier filter. A tier AutoShift adds later still gets a button, after these. */
const TIER_ORDER = ['stable', 'certified', 'community'];

const tierRank = (tier: string): number => {
  const i = TIER_ORDER.indexOf(tier);
  return i < 0 ? TIER_ORDER.length : i;
};

const TierLabel: FC<{ tier?: string }> = ({ tier }) => {
  const { t } = useTranslation('plugin__autoshift-console');
  if (!tier) {
    return null;
  }
  const label = (
    <Label isCompact color={TIER_COLOURS[tier] ?? 'grey'}>
      {tier}
    </Label>
  );

  // Spelled out rather than looked up from a map: a t() call with a computed key is invisible to
  // the extractor, and the string would never reach the locale file.
  const hint =
    tier === 'stable'
      ? t('Supported by the AutoShift project')
      : tier === 'certified'
        ? t('Certified by the vendor, maintained outside the project')
        : tier === 'community'
          ? t('Community-contributed — least tested')
          : undefined;

  return hint ? <Tooltip content={hint}>{label}</Tooltip> : label;
};

/** One component row plus its expandable policy-verdict detail. */
const ComponentRows: FC<{
  component: Component;
  showTier: boolean;
  rowIndex: number;
  policyNamespace: string;
}> = ({ component, showTier, rowIndex, policyNamespace }) => {
  const { t } = useTranslation('plugin__autoshift-console');
  const [expanded, setExpanded] = useState(false);
  const toggle = () => {
    setExpanded(!expanded);
  };
  const placed = component.clusters.length > 0;

  // Three distinct situations that all used to read "No policies": nothing is placed, the
  // component ships no policy at all, or the policies exist but ACM has not reported on them yet.
  const unknownCompliance = !placed
    ? t('N/A')
    : component.policies.length === 0
      ? t('No policies')
      : t('Not yet evaluated');

  return (
    <>
      <Tr isClickable onRowClick={toggle}>
        <Td expand={{ rowIndex, isExpanded: expanded, onToggle: toggle }} />
        <Td dataLabel={t('Component')}>{component.name}</Td>
        {showTier && (
          <Td dataLabel={t('Tier')}>
            {component.tier ? (
              <TierLabel tier={component.tier} />
            ) : (
              <span className="autoshift-console__muted">—</span>
            )}
          </Td>
        )}
        <Td dataLabel={t('Gating label')}>
          {component.gatingLabels.length === 0 ? (
            <span className="autoshift-console__muted">{t('always placed')}</span>
          ) : (
            <LabelGroup numLabels={3}>
              {component.gatingLabels.map((key) => (
                <Label key={key} isCompact color="blue">
                  {shortLabel(key)}
                </Label>
              ))}
            </LabelGroup>
          )}
        </Td>
        <Td dataLabel={t('Clusters')}>{component.clusters.length}</Td>
        {/* Sync, health and compliance are all suppressed on a component no Placement selects:
            with nothing running there is nothing for them to be a verdict on. */}
        <Td dataLabel={t('Sync')}>
          <ArgoLabel status={component.syncStatus} placed={placed} />
        </Td>
        <Td dataLabel={t('Health')}>
          <ArgoLabel status={component.healthStatus} placed={placed} />
        </Td>
        <Td dataLabel={t('Compliance')}>
          <ComplianceLabel counts={component.compliance} unknownText={unknownCompliance} />
        </Td>
      </Tr>
      {expanded && (
        <Tr isExpanded>
          <Td colSpan={showTier ? 8 : 7}>
            {/* Cluster column stays: a component spans clusters, and "which one is failing" is
                the whole reason to open this row. */}
            <ComplianceDetail
              checks={component.checks}
              policyNamespace={policyNamespace}
              emptyText={
                !placed
                  ? t(
                      'No cluster is selected by this component’s Placement, so nothing evaluates it.',
                    )
                  : component.policies.length === 0
                    ? t('This component ships no policy.')
                    : undefined
              }
            />
          </Td>
        </Tr>
      )}
    </>
  );
};

const ComponentTable: FC<{
  components: Component[];
  showTier: boolean;
  policyNamespace: string;
}> = ({ components, showTier, policyNamespace }) => {
  const { t } = useTranslation('plugin__autoshift-console');

  return (
    <Table variant="compact" aria-label={t('Components')}>
      <Thead>
        <Tr>
          <Th screenReaderText={t('Expand')} />
          <Th width={20}>{t('Component')}</Th>
          {showTier && <Th width={10}>{t('Tier')}</Th>}
          <Th width={25}>{t('Gating label')}</Th>
          <Th width={10}>{t('Clusters')}</Th>
          <Th width={15}>{t('Sync')}</Th>
          <Th width={10}>{t('Health')}</Th>
          <Th width={10}>{t('Compliance')}</Th>
        </Tr>
      </Thead>
      {components.map((component, i) => (
        <Tbody key={component.name}>
          <ComponentRows
            component={component}
            showTier={showTier}
            rowIndex={i}
            policyNamespace={policyNamespace}
          />
        </Tbody>
      ))}
    </Table>
  );
};

/**
 * One row per component — one Argo CD Application, i.e. one policy folder in AutoShift.
 *
 * There is deliberately no thematic grouping. Nothing on the cluster says what a component is
 * for, so any stack layer has to be a hand-kept list, and AutoShift adds components faster than a
 * list can follow. Everything shown here is read off live objects, so a component added to
 * AutoShift appears correctly as soon as Argo CD syncs it. Tier is the only grouping the cluster
 * itself carries (policies/<tier>/<name>), so it is offered as a filter. OCI mode deploys with no
 * source path and therefore no tier, and then the column and filter are hidden rather than blank.
 */
const ComponentsPage: FC = () => {
  const { t } = useTranslation('plugin__autoshift-console');
  const [tier, setTier] = useState<string | undefined>();
  const [filter, setFilter] = useState('');

  return (
    <PageFrame title={t('Components')}>
      {(model) => {
        if (model.components.length === 0) {
          return (
            <EmptyState titleText={t('No components found')} headingLevel="h4">
              <EmptyStateBody>
                {t(
                  'No ArgoCD Applications were found for this deployment. Check that the AutoShift ApplicationSet has synced.',
                )}
              </EmptyStateBody>
            </EmptyState>
          );
        }

        const tiers = Array.from(
          new Set(model.components.flatMap((c) => (c.tier ? [c.tier] : []))),
        ).sort((a, b) => tierRank(a) - tierRank(b) || a.localeCompare(b));
        const needle = filter.trim().toLowerCase();
        const shown = model.components.filter(
          (c) =>
            (!tier || c.tier === tier) &&
            (!needle ||
              c.name.toLowerCase().includes(needle) ||
              c.gatingLabels.some((l) => l.toLowerCase().includes(needle))),
        );

        return (
          <>
            <Split hasGutter className="autoshift-console__grouping">
              {tiers.length > 1 && (
                <SplitItem>
                  <ToggleGroup aria-label={t('Filter components by tier')}>
                    <ToggleGroupItem
                      text={t('All')}
                      buttonId="all"
                      isSelected={!tier}
                      onChange={() => {
                        setTier(undefined);
                      }}
                    />
                    {tiers.map((name) => (
                      <ToggleGroupItem
                        key={name}
                        text={name}
                        buttonId={name}
                        isSelected={tier === name}
                        onChange={() => {
                          setTier(name);
                        }}
                      />
                    ))}
                  </ToggleGroup>
                </SplitItem>
              )}
              <SplitItem>
                <SearchInput
                  placeholder={t('Filter by name or label')}
                  value={filter}
                  onChange={(_e, value) => {
                    setFilter(value);
                  }}
                  onClear={() => {
                    setFilter('');
                  }}
                />
              </SplitItem>
              <SplitItem isFilled />
              <SplitItem>
                <span className="autoshift-console__muted">
                  {t('{{shown}} of {{total}} components', {
                    shown: shown.length,
                    total: model.components.length,
                  })}
                </span>
              </SplitItem>
            </Split>

            {shown.length === 0 ? (
              <EmptyState titleText={t('No components match')} headingLevel="h4">
                <EmptyStateBody>{t('Nothing matched that filter.')}</EmptyStateBody>
              </EmptyState>
            ) : (
              <ComponentTable
                components={shown}
                showTier={tiers.length > 0}
                policyNamespace={model.deployment.policyNamespace}
              />
            )}
          </>
        );
      }}
    </PageFrame>
  );
};

export default ComponentsPage;
