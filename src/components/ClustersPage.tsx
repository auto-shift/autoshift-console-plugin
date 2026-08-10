import { useState } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerContentBody,
  DrawerPanelContent,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useTranslation } from 'react-i18next';
import type { FC } from 'react';
import type { ClusterView } from '../types/autoshift';
import { PageFrame } from './common/PageFrame';
import { AvailabilityLabel, ComplianceLabel, DriftLabel } from './common/status';
import { ClusterDetailPanel } from './ClusterDetailPanel';

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
            <Thead>
              <Tr>
                <Th>{t('Name')}</Th>
                <Th>{t('Cluster set')}</Th>
                <Th>{t('AutoShift')}</Th>
                <Th>{t('Type')}</Th>
                <Th>{t('OpenShift')}</Th>
                <Th>{t('Status')}</Th>
                <Th>{t('Label drift')}</Th>
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
                  {/* Which AutoShift release manages this cluster, from the stamped
                      owning-deployment label, plus the git branch/tag or OCI version that
                      deployment is tracking. */}
                  <Td dataLabel={t('Cluster set')}>{cluster.clusterSet ?? '—'}</Td>
                  <Td dataLabel={t('AutoShift')}>
                    {cluster.owningDeployment ?? deployment.release}
                    {deployment.version && (
                      <div className="autoshift-console__subtle">{deployment.version}</div>
                    )}
                  </Td>
                  <Td dataLabel={t('Type')}>
                    {cluster.clusterType ?? '—'}
                    {cluster.selfManaged && ` · ${t('self-managed')}`}
                  </Td>
                  <Td dataLabel={t('OpenShift')}>
                    {cluster.openshiftVersion ?? cluster.kubernetesVersion ?? '—'}
                  </Td>
                  <Td dataLabel={t('Status')}>
                    <AvailabilityLabel
                      available={cluster.available}
                      upText={t('Available')}
                      downText={t('Unavailable')}
                    />
                  </Td>
                  <Td dataLabel={t('Label drift')}>
                    <DriftLabel count={cluster.labelDrift.length} inSyncText={t('In sync')} />
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
