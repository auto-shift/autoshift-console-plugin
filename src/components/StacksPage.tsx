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

const TIER_COLOURS: Record<string, 'blue' | 'purple' | 'orange' | 'grey'> = {
  stable: 'blue',
  certified: 'purple',
  community: 'orange',
};

const TierLabel: FC<{ tier?: string }> = ({ tier }) => {
  if (!tier) {
    return null;
  }
  return (
    <Label isCompact color={TIER_COLOURS[tier] ?? 'grey'}>
      {tier}
    </Label>
  );
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
        <Td dataLabel={t('Sync')}>
          <ArgoLabel status={component.syncStatus} />
        </Td>
        <Td dataLabel={t('Health')}>
          <ArgoLabel status={component.healthStatus} />
        </Td>
        <Td dataLabel={t('Compliance')}>
          <ComplianceLabel counts={component.compliance} unknownText={t('No policies')} />
        </Td>
      </Tr>
      {expanded && (
        <Tr isExpanded>
          <Td colSpan={span}>
            {/* Cluster column stays: a component spans clusters, and "which one is failing" is
                the whole reason to open this row. */}
            <ComplianceDetail checks={component.checks} policyNamespace={policyNamespace} />
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
