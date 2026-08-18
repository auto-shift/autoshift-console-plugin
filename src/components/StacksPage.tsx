import { useState } from 'react';
import {
  Card,
  CardBody,
  CardTitle,
  EmptyState,
  EmptyStateBody,
  Label,
  LabelGroup,
  Split,
  SplitItem,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useTranslation } from 'react-i18next';
import type { FC } from 'react';
import type { Stack, Component } from '../types/autoshift';
import { PageFrame } from './common/PageFrame';
import { ArgoLabel, ComplianceLabel } from './common/status';
import { shortLabel } from '../lib/config';
import { groupByTier } from '../lib/catalog';
import { ComplianceDetail } from './common/ComplianceDetail';

import './autoshift.css';

type Grouping = 'stack' | 'tier';

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
  const span = showTier ? 8 : 7;
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
            <TierLabel tier={component.tier} />
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
          <Td colSpan={span}>
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

const StackTable: FC<{ stack: Stack; showTier: boolean; policyNamespace: string }> = ({
  stack,
  showTier,
  policyNamespace,
}) => {
  const { t } = useTranslation('plugin__autoshift-console');

  return (
    <Table variant="compact" aria-label={stack.name}>
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
      {stack.components.map((component, i) => (
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

const StacksPage: FC = () => {
  const { t } = useTranslation('plugin__autoshift-console');
  const [grouping, setGrouping] = useState<Grouping>('stack');

  return (
    <PageFrame title={t('Stacks')}>
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

        const groups = grouping === 'tier' ? groupByTier(model.components) : model.stacks;

        return (
          <>
            <Split hasGutter className="autoshift-console__grouping">
              <SplitItem>
                <ToggleGroup aria-label={t('Group components by')}>
                  <ToggleGroupItem
                    text={t('By stack')}
                    buttonId="stack"
                    isSelected={grouping === 'stack'}
                    onChange={() => {
                      setGrouping('stack');
                    }}
                  />
                  <ToggleGroupItem
                    text={t('By tier')}
                    buttonId="tier"
                    isSelected={grouping === 'tier'}
                    onChange={() => {
                      setGrouping('tier');
                    }}
                  />
                </ToggleGroup>
              </SplitItem>
            </Split>

            {groups.map((stack) => (
              <Card key={stack.id} className="autoshift-console__stack">
                <CardTitle>
                  {grouping === 'tier' ? <TierLabel tier={stack.name} /> : stack.name}{' '}
                  <Label isCompact color="grey">
                    {stack.components.length}
                  </Label>
                </CardTitle>
                <CardBody>
                  <StackTable
                    stack={stack}
                    showTier={grouping === 'stack'}
                    policyNamespace={model.deployment.policyNamespace}
                  />
                </CardBody>
              </Card>
            ))}
          </>
        );
      }}
    </PageFrame>
  );
};

export default StacksPage;
