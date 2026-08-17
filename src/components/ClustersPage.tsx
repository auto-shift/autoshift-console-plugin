import { useState } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerContentBody,
  DrawerPanelContent,
  Label,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useTranslation } from 'react-i18next';
import type { FC } from 'react';
import type { ClusterView } from '../types/autoshift';
import { PageFrame } from './common/PageFrame';
import { AvailabilityLabel, ComplianceLabel } from './common/status';
import { ClusterDetailPanel } from './ClusterDetailPanel';
import { shortRevision } from '../lib/config';

import './autoshift.css';

const ClustersPage: FC = () => {
  const { t } = useTranslation('plugin__autoshift-console');
  const [selectedName, setSelectedName] = useState<string | undefined>();

  return (
    <PageFrame title={t('Clusters')}>
      {(model, deployment) => {
        const selected: ClusterView | undefined = model.clusters.find(
          (c) => c.name === selectedName,
        );

        const table = (
          <Table variant="compact" aria-label={t('Clusters')}>
            {/* Headers that can truncate carry their own tooltip: "Cluster ..." with nothing to
                hover is a column with no name at all. Fleet and tracking ref are separate columns
                rather than two lines in one cell — they are different facts and sort differently. */}
            <Thead>
              <Tr>
                <Th>{t('Name')}</Th>
                <Th info={{ tooltip: t('ACM cluster set this cluster belongs to') }}>
                  {t('Cluster set')}
                </Th>
                <Th info={{ tooltip: t('AutoShift deployment that manages this cluster') }}>
                  {t('AutoShift')}
                </Th>
                <Th info={{ tooltip: t('Git ref or OCI version that deployment follows') }}>
                  {t('Tracking ref')}
                </Th>
                <Th>{t('Type')}</Th>
                <Th>{t('OpenShift')}</Th>
                <Th>{t('Status')}</Th>
                <Th>{t('Compliance')}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {model.clusters.map((cluster) => (
                <Tr
                  key={cluster.name}
                  isClickable
                  isRowSelected={cluster.name === selectedName}
                  onRowClick={() => {
                    setSelectedName(cluster.name === selectedName ? undefined : cluster.name);
                  }}
                >
                  <Td dataLabel={t('Name')}>{cluster.name}</Td>
                  <Td dataLabel={t('Cluster set')}>{cluster.clusterSet ?? '—'}</Td>
                  {/* Which AutoShift release manages this cluster, from the stamped
                      owning-deployment label. */}
                  <Td dataLabel={t('AutoShift')}>
                    {cluster.owningDeployment ?? deployment.release}
                  </Td>
                  {/* The ref that deployment follows, with the commit it resolved to underneath.
                      A branch name alone does not say what is running. */}
                  <Td dataLabel={t('Tracking ref')}>
                    {deployment.trackingRef ?? '—'}
                    {deployment.revision && (
                      <div className="autoshift-console__subtle">
                        {shortRevision(deployment.revision)}
                      </div>
                    )}
                  </Td>
                  <Td dataLabel={t('Type')}>
                    {cluster.clusterType ?? '—'}
                    {cluster.selfManaged && ` · ${t('self-managed')}`}
                  </Td>
                  {/* Desired-vs-actual is shown for the version and nowhere else: an upgrade takes
                      hours, so the gap is real state. Labels and config are reconciled by an
                      enforcing policy, so comparing them client-side only ever races it. */}
                  <Td dataLabel={t('OpenShift')}>
                    {cluster.openshiftVersion ?? cluster.kubernetesVersion ?? '—'}
                    {cluster.upgradePending && (
                      <Label color="orange" isCompact className="autoshift-console__inline-label">
                        {t('→ {{version}}', { version: cluster.desiredVersion })}
                      </Label>
                    )}
                  </Td>
                  <Td dataLabel={t('Status')}>
                    <AvailabilityLabel
                      available={cluster.available}
                      upText={t('Available')}
                      downText={t('Unavailable')}
                    />
                  </Td>
                  <Td dataLabel={t('Compliance')}>
                    <ComplianceLabel counts={cluster.compliance} unknownText={t('No policies')} />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        );

        return (
          <Drawer isExpanded={!!selected} isInline>
            <DrawerContent
              panelContent={
                <DrawerPanelContent isResizable defaultSize="60%" minSize="30%">
                  {selected && (
                    <ClusterDetailPanel
                      cluster={selected}
                      policyNamespace={deployment.policyNamespace}
                      onClose={() => {
                        setSelectedName(undefined);
                      }}
                    />
                  )}
                </DrawerPanelContent>
              }
            >
              <DrawerContentBody>{table}</DrawerContentBody>
            </DrawerContent>
          </Drawer>
        );
      }}
    </PageFrame>
  );
};

export default ClustersPage;
