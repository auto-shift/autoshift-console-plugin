import { useMemo, useState } from 'react';
import {
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  DrawerActions,
  DrawerCloseButton,
  DrawerHead,
  DrawerPanelBody,
  EmptyState,
  EmptyStateBody,
  Label,
  SearchInput,
  Tab,
  TabTitleText,
  Tabs,
  Title,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useTranslation } from 'react-i18next';
import type { FC } from 'react';
import type { ClusterView, LayerName } from '../types/autoshift';
import { AUTO_STAMPED_LABELS, formatValue, shortLabel } from '../lib/config';
import { AvailabilityLabel, ComplianceLabel } from './common/status';
import { ComplianceDetail } from './common/ComplianceDetail';

import './autoshift.css';

const LAYER_TITLES: Record<LayerName, string> = {
  default: 'Fleet default',
  clusterSet: 'Cluster set',
  cluster: 'Cluster override',
};

/** The layer chain for one setting: superseded layers struck through, the winner highlighted. */
const ProvenanceChain: FC<{
  layers: ClusterView['provenance'][number]['layers'];
}> = ({ layers }) => {
  const { t } = useTranslation('plugin__autoshift-console');

  if (layers.length === 0) {
    return (
      <span className="autoshift-console__muted">{t('Set by the policy, not by values')}</span>
    );
  }

  return (
    <span className="autoshift-console__chain">
      {layers.map((layer, i) => (
        <span key={`${layer.layer}-${layer.source}`}>
          {i > 0 && <span className="autoshift-console__arrow">→</span>}
          <span
            className={layer.wins ? 'autoshift-console__wins' : 'autoshift-console__superseded'}
            title={`${LAYER_TITLES[layer.layer]} · ${layer.source}`}
          >
            {formatValue(layer.value)}
          </span>
        </span>
      ))}
    </span>
  );
};

export const ClusterDetailPanel: FC<{
  cluster: ClusterView;
  /** Namespace the deployment's policies live in, for the ACM Governance deep links. */
  policyNamespace: string;
  onClose: () => void;
}> = ({ cluster, policyNamespace, onClose }) => {
  const { t } = useTranslation('plugin__autoshift-console');
  const [activeTab, setActiveTab] = useState<string | number>('provenance');
  const [filter, setFilter] = useState('');
  const [labelFilter, setLabelFilter] = useState('');

  const provenance = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) {
      return cluster.provenance;
    }
    return cluster.provenance.filter((p) => p.path.toLowerCase().includes(needle));
  }, [cluster.provenance, filter]);

  // Built once per cluster and filtered separately, so typing in the filter does not re-derive the
  // whole row set — a cluster set carries a few hundred labels.
  const allLabelRows = useMemo(
    () =>
      Object.entries(cluster.actualLabels)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => ({ key, value, autoStamped: AUTO_STAMPED_LABELS.has(key) })),
    [cluster.actualLabels],
  );

  const labelRows = useMemo(() => {
    const needle = labelFilter.trim().toLowerCase();
    if (!needle) {
      return allLabelRows;
    }
    return allLabelRows.filter((r) => r.key.toLowerCase().includes(needle));
  }, [allLabelRows, labelFilter]);

  const overridden = cluster.provenance.filter((p) => p.layers.length > 1).length;

  return (
    <>
      <DrawerHead>
        <Title headingLevel="h2" size="xl">
          {cluster.name}
        </Title>
        <DrawerActions>
          <DrawerCloseButton onClick={onClose} />
        </DrawerActions>
      </DrawerHead>
      <DrawerPanelBody>
        <DescriptionList isHorizontal isCompact className="autoshift-console__summary">
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Cluster set')}</DescriptionListTerm>
            <DescriptionListDescription>{cluster.clusterSet ?? '—'}</DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Type')}</DescriptionListTerm>
            <DescriptionListDescription>
              {cluster.clusterType ?? '—'}
              {cluster.selfManaged && ` · ${t('self-managed')}`}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('OpenShift version')}</DescriptionListTerm>
            <DescriptionListDescription>
              {cluster.openshiftVersion ?? cluster.kubernetesVersion ?? '—'}
              {cluster.upgradePending && (
                <Label color="orange" isCompact className="autoshift-console__inline-label">
                  {t('desired {{version}}', { version: cluster.desiredVersion })}
                </Label>
              )}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Status')}</DescriptionListTerm>
            <DescriptionListDescription>
              <AvailabilityLabel
                available={cluster.available}
                upText={t('Available')}
                downText={t('Unavailable')}
              />{' '}
              <ComplianceLabel counts={cluster.compliance} unknownText={t('No policies')} />
            </DescriptionListDescription>
          </DescriptionListGroup>
        </DescriptionList>

        <Tabs
          activeKey={activeTab}
          onSelect={(_e, key) => {
            setActiveTab(key);
          }}
        >
          <Tab
            eventKey="provenance"
            title={<TabTitleText>{t('Config provenance')}</TabTitleText>}
            aria-label={t('Config provenance')}
          >
            <Content component="p" className="autoshift-console__tab-intro">
              {t('{{overridden}} of {{total}} settings overridden', {
                overridden,
                total: cluster.provenance.length,
              })}
            </Content>
            <SearchInput
              placeholder={t('Filter by setting path')}
              value={filter}
              onChange={(_e, value) => {
                setFilter(value);
              }}
              onClear={() => {
                setFilter('');
              }}
              className="autoshift-console__filter"
            />
            {provenance.length === 0 ? (
              <EmptyState titleText={t('No settings')} headingLevel="h4">
                <EmptyStateBody>
                  {t('No configuration matched. This cluster may have no config layers yet.')}
                </EmptyStateBody>
              </EmptyState>
            ) : (
              <Table variant="compact" aria-label={t('Config provenance')}>
                <Thead>
                  <Tr>
                    <Th width={40}>{t('Setting')}</Th>
                    <Th width={40}>{t('Layer chain')}</Th>
                    <Th width={20}>{t('Resolved')}</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {provenance.map((p) => (
                    <Tr key={p.path}>
                      <Td dataLabel={t('Setting')}>
                        <code className="autoshift-console__path">{p.path}</code>
                      </Td>
                      <Td dataLabel={t('Layer chain')}>
                        <ProvenanceChain layers={p.layers} />
                      </Td>
                      <Td dataLabel={t('Resolved')}>{formatValue(p.resolved)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </Tab>

          <Tab
            eventKey="labels"
            title={<TabTitleText>{t('Labels')}</TabTitleText>}
            aria-label={t('Labels')}
          >
            <SearchInput
              placeholder={t('Filter by label')}
              value={labelFilter}
              onChange={(_e, value) => {
                setLabelFilter(value);
              }}
              onClear={() => {
                setLabelFilter('');
              }}
              className="autoshift-console__filter"
            />
            {/* One value column, not desired-vs-actual: cluster-labels is a mustonlyhave enforce
                policy, so the two agree except while it is mid-reconcile. Its compliance status is
                on the Compliance tab and is the authoritative signal if they ever diverge. */}
            <Table variant="compact" aria-label={t('Labels')}>
              <Thead>
                <Tr>
                  <Th width={50}>{t('Label')}</Th>
                  <Th width={35}>{t('Value')}</Th>
                  <Th width={15}>{t('Source')}</Th>
                </Tr>
              </Thead>
              <Tbody>
                {labelRows.map(({ key, value, autoStamped }) => (
                  <Tr key={key}>
                    <Td dataLabel={t('Label')}>
                      <code className="autoshift-console__path">{shortLabel(key)}</code>
                    </Td>
                    <Td dataLabel={t('Value')}>{value}</Td>
                    <Td dataLabel={t('Source')}>
                      <Label color={autoStamped ? 'grey' : 'blue'} isCompact>
                        {autoStamped ? t('auto-stamped') : t('values')}
                      </Label>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Tab>
          <Tab
            eventKey="compliance"
            title={
              <TabTitleText>
                {t('Compliance')}
                {cluster.compliance.nonCompliant > 0 &&
                  ` (${String(cluster.compliance.nonCompliant)})`}
              </TabTitleText>
            }
            aria-label={t('Compliance')}
          >
            {/* Every row is this cluster, so the cluster column would repeat one value. */}
            <ComplianceDetail
              checks={cluster.checks}
              policyNamespace={policyNamespace}
              showCluster={false}
            />
          </Tab>
        </Tabs>
      </DrawerPanelBody>
    </>
  );
};
