import {
  Card,
  CardBody,
  CardTitle,
  EmptyState,
  EmptyStateBody,
  Flex,
  FlexItem,
  Label,
  Title,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useTranslation } from 'react-i18next';
import type { FC, ReactNode } from 'react';
import type { ClusterView, Stack } from '../types/autoshift';
import { PageFrame } from './common/PageFrame';

import './autoshift.css';

const Tile: FC<{ value: ReactNode; label: string; tone?: 'warn' | 'danger' }> = ({
  value,
  label,
  tone,
}) => (
  <Card isCompact className="autoshift-console__tile">
    <CardBody>
      <div
        className={
          tone === 'danger'
            ? 'autoshift-console__tile-value autoshift-console__tile-value--danger'
            : tone === 'warn'
              ? 'autoshift-console__tile-value autoshift-console__tile-value--warn'
              : 'autoshift-console__tile-value'
        }
      >
        {value}
      </div>
      <div className="autoshift-console__tile-label">{label}</div>
    </CardBody>
  </Card>
);

type Coverage = 'all' | 'partial' | 'none';

/** How much of a cluster set a stack covers, from live PlacementDecisions. */
const coverageOf = (stack: Stack, setClusters: string[]): Coverage => {
  if (setClusters.length === 0 || stack.components.length === 0) {
    return 'none';
  }
  const covered = setClusters.filter((name) =>
    stack.components.some((c) => c.clusters.includes(name)),
  ).length;
  if (covered === 0) {
    return 'none';
  }
  return covered === setClusters.length ? 'all' : 'partial';
};

const CoverageCell: FC<{ coverage: Coverage }> = ({ coverage }) => {
  const { t } = useTranslation('plugin__autoshift-console');
  if (coverage === 'all') {
    return (
      <Label isCompact color="green">
        {t('on')}
      </Label>
    );
  }
  if (coverage === 'partial') {
    return (
      <Label isCompact color="orange">
        {t('partial')}
      </Label>
    );
  }
  return <span className="autoshift-console__muted">—</span>;
};

const needsAttention = (c: ClusterView): boolean =>
  !c.available || c.labelDrift.length > 0 || c.compliance.nonCompliant > 0 || c.versionDrift;

const FleetPage: FC = () => {
  const { t } = useTranslation('plugin__autoshift-console');

  return (
    <PageFrame title={t('AutoShift fleet')}>
      {(model, deployment) => {
        const attention = model.clusters.filter(needsAttention);
        const driftCount = model.clusters.filter((c) => c.labelDrift.length > 0).length;
        const nonCompliant = model.clusters.filter((c) => c.compliance.nonCompliant > 0).length;

        return (
          <>
            <Flex className="autoshift-console__tiles">
              <FlexItem>
                <Tile value={model.clusters.length} label={t('Clusters')} />
              </FlexItem>
              <FlexItem>
                <Tile value={model.clusterSets.length} label={t('Cluster sets')} />
              </FlexItem>
              <FlexItem>
                <Tile value={model.components.length} label={t('Components')} />
              </FlexItem>
              <FlexItem>
                <Tile
                  value={driftCount}
                  label={t('Clusters with label drift')}
                  tone={driftCount > 0 ? 'warn' : undefined}
                />
              </FlexItem>
              <FlexItem>
                <Tile
                  value={nonCompliant}
                  label={t('Clusters non-compliant')}
                  tone={nonCompliant > 0 ? 'danger' : undefined}
                />
              </FlexItem>
              <FlexItem>
                <Tile value={deployment.version ?? '—'} label={t('AutoShift version')} />
              </FlexItem>
            </Flex>

            <Card className="autoshift-console__stack">
              <CardTitle>{t('Stack coverage by cluster set')}</CardTitle>
              <CardBody>
                {model.stacks.length === 0 || model.clusterSets.length === 0 ? (
                  <EmptyState titleText={t('Nothing to chart yet')} headingLevel="h4">
                    <EmptyStateBody>
                      {t('No stacks or cluster sets were discovered for this deployment.')}
                    </EmptyStateBody>
                  </EmptyState>
                ) : (
                  <Table variant="compact" aria-label={t('Stack coverage by cluster set')}>
                    <Thead>
                      <Tr>
                        <Th>{t('Stack')}</Th>
                        {model.clusterSets.map((set) => (
                          <Th key={set.name}>{set.name}</Th>
                        ))}
                      </Tr>
                    </Thead>
                    <Tbody>
                      {model.stacks.map((stack) => (
                        <Tr key={stack.id}>
                          <Td dataLabel={t('Stack')}>{stack.name}</Td>
                          {model.clusterSets.map((set) => (
                            <Td key={set.name} dataLabel={set.name}>
                              <CoverageCell coverage={coverageOf(stack, set.clusters)} />
                            </Td>
                          ))}
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                )}
              </CardBody>
            </Card>

            <Card className="autoshift-console__stack">
              <CardTitle>
                <Title headingLevel="h3" size="md">
                  {t('Clusters needing attention')}
                </Title>
              </CardTitle>
              <CardBody>
                {attention.length === 0 ? (
                  <EmptyState titleText={t('Everything matches')} headingLevel="h4">
                    <EmptyStateBody>
                      {t(
                        'Every cluster is available, its labels match what AutoShift intends, and no policy is non-compliant.',
                      )}
                    </EmptyStateBody>
                  </EmptyState>
                ) : (
                  <Table variant="compact" aria-label={t('Clusters needing attention')}>
                    <Thead>
                      <Tr>
                        <Th>{t('Cluster')}</Th>
                        <Th>{t('Cluster set')}</Th>
                        <Th>{t('Reason')}</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {attention.map((cluster) => (
                        <Tr key={cluster.name}>
                          <Td dataLabel={t('Cluster')}>{cluster.name}</Td>
                          <Td dataLabel={t('Cluster set')}>{cluster.clusterSet ?? '—'}</Td>
                          <Td dataLabel={t('Reason')}>
                            {!cluster.available && (
                              <Label isCompact color="red">
                                {t('unavailable')}
                              </Label>
                            )}{' '}
                            {cluster.compliance.nonCompliant > 0 && (
                              <Label isCompact color="red">
                                {t('{{count}} policies non-compliant', {
                                  count: cluster.compliance.nonCompliant,
                                })}
                              </Label>
                            )}{' '}
                            {cluster.labelDrift.length > 0 && (
                              <Label isCompact color="orange">
                                {t('{{count}} labels drifted', {
                                  count: cluster.labelDrift.length,
                                })}
                              </Label>
                            )}{' '}
                            {cluster.versionDrift && (
                              <Label isCompact color="orange">
                                {t('version {{actual}}, desired {{desired}}', {
                                  actual: cluster.openshiftVersion,
                                  desired: cluster.desiredVersion,
                                })}
                              </Label>
                            )}
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                )}
              </CardBody>
            </Card>
          </>
        );
      }}
    </PageFrame>
  );
};

export default FleetPage;
