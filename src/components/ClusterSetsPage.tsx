import { useMemo, useState } from 'react';
import {
  Card,
  CardBody,
  CardTitle,
  Content,
  EmptyState,
  EmptyStateBody,
  Label,
  SearchInput,
  ToggleGroup,
  ToggleGroupItem,
  Split,
  SplitItem,
  Tooltip,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useTranslation } from 'react-i18next';
import { Link } from '@compat/router';
import type { FC } from 'react';
import type { ClusterSetView, FeatureView } from '../types/autoshift';
import { PageFrame } from './common/PageFrame';
import { LABEL_CONCERN_ORDER, formatValue, labelState, toLabelRow } from '../lib/config';
import { acmPolicyResultsUrl } from '../lib/acm';
import { ArgoLabel } from './common/status';

import './autoshift.css';

/** Above this many clusters the names go into a tooltip rather than inline in the cell. */
const INLINE_CLUSTER_LIMIT = 3;

/** A label value rendered by meaning rather than by raw string. */
const ValueLabel: FC<{ name: string; value?: string }> = ({ name, value }) => {
  const { t } = useTranslation('plugin__autoshift-console');
  const state = labelState(name, value);
  if (state === 'on') {
    return (
      <Label isCompact color="green">
        {t('on')}
      </Label>
    );
  }
  if (state === 'off') {
    return (
      <Label isCompact color="grey">
        {t('off')}
      </Label>
    );
  }
  return <span className="autoshift-console__value">{value === '' ? '—' : value}</span>;
};

/** Expanded detail for one feature: its labels, its config block, and what delivers it. */
type DetailView = 'labels' | 'config' | 'consumers';

/**
 * Expanded detail for one feature.
 *
 * Deliberately the same shape as ComplianceDetail — a toggle to pick the view, a search box, and a
 * single table — rather than three stacked sections. Three tables at once gave no way to narrow
 * anything and made a feature like gitlab (24 labels) a long scroll.
 */
const FeatureDetail: FC<{ feature: FeatureView; policyNamespace: string }> = ({
  feature,
  policyNamespace,
}) => {
  const { t } = useTranslation('plugin__autoshift-console');
  const [view, setView] = useState<DetailView>('labels');
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();

  /*
   * Ordered by concern rather than printed in one alphabetical run: an unfiltered list of a
   * feature's labels reads like a ConfigMap dump, and the reader ends up sorting it themselves.
   *
   * The groups are ordering only and carry no headings. A label row inside a table that already
   * has a header row competes with it, and PatternFly's isSubheader is for nested *column*
   * headers, not row categories — it also had to claim scope="colgroup" for something describing
   * a group of rows. The rows say what they are without it: Channel, Version, Catalog and Image
   * read as a set on their own.
   *
   * The feature's own on/off label is deliberately absent. The row this panel expands from
   * already carries a State column, so repeating it here restated the same value one row later.
   */
  const labelGroups = useMemo(() => {
    const rows = feature.settings
      .map((r) => toLabelRow(feature.name, r.key, r.value))
      .filter(
        (r) =>
          !needle ||
          r.key.toLowerCase().includes(needle) ||
          r.display.toLowerCase().includes(needle),
      );

    return LABEL_CONCERN_ORDER.map((concern) => ({
      concern,
      rows: rows.filter((r) => r.concern === concern),
    })).filter((g) => g.rows.length > 0);
  }, [feature, needle]);

  const labelRowCount = labelGroups.reduce((n, g) => n + g.rows.length, 0);

  const configRows = useMemo(
    () =>
      needle ? feature.config.filter((c) => c.path.toLowerCase().includes(needle)) : feature.config,
    [feature.config, needle],
  );

  const consumerRows = useMemo(
    () =>
      needle
        ? feature.components.filter((c) => c.name.toLowerCase().includes(needle))
        : feature.components,
    [feature.components, needle],
  );

  const labelCount = feature.settings.length;
  const empty = (message: string) => (
    <Content component="p" className="autoshift-console__muted">
      {message}
    </Content>
  );

  return (
    <div className="autoshift-console__detail">
      <div className="autoshift-console__detail-controls">
        <ToggleGroup aria-label={t('Feature detail view')}>
          <ToggleGroupItem
            text={t('Labels ({{count}})', { count: labelCount })}
            buttonId="labels"
            isSelected={view === 'labels'}
            onChange={() => {
              setView('labels');
            }}
          />
          <ToggleGroupItem
            text={t('Config ({{count}})', { count: feature.config.length })}
            buttonId="config"
            isSelected={view === 'config'}
            onChange={() => {
              setView('config');
            }}
          />
          <ToggleGroupItem
            text={t('Consumed by ({{count}})', { count: feature.components.length })}
            buttonId="consumers"
            isSelected={view === 'consumers'}
            onChange={() => {
              setView('consumers');
            }}
          />
        </ToggleGroup>
        <SearchInput
          placeholder={t('Filter')}
          value={filter}
          onChange={(_e, value) => {
            setFilter(value);
          }}
          onClear={() => {
            setFilter('');
          }}
        />
      </div>

      {view === 'labels' &&
        (labelCount === 0 ? (
          empty(t('This feature has no settings beyond its on/off state.'))
        ) : labelRowCount === 0 ? (
          empty(t('Nothing matched that filter.'))
        ) : (
          <Table variant="compact" aria-label={t('Labels')}>
            <Thead>
              <Tr>
                <Th width={70}>{t('Label')}</Th>
                <Th width={30}>{t('Value')}</Th>
              </Tr>
            </Thead>
            {labelGroups.map((group) => (
              <Tbody key={group.concern} className="autoshift-console__label-group">
                {group.rows.map((row) => (
                  <Tr key={row.key}>
                    {/* The readable name leads; the raw key stays underneath because it is what
                        someone editing a values file has to type. */}
                    <Td dataLabel={t('Label')}>
                      {row.display}
                      <div className="autoshift-console__subtle">
                        <code>{row.key}</code>
                      </div>
                    </Td>
                    {/* labelState is given the RAW key: it is the trailing -disabled that tells it
                        to invert, and the display name has had that stripped off. */}
                    <Td dataLabel={t('Value')}>
                      <ValueLabel name={row.key} value={row.value} />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            ))}
          </Table>
        ))}

      {view === 'config' &&
        (feature.config.length === 0 ? (
          empty(t('This feature is label-driven only — it has no config block.'))
        ) : configRows.length === 0 ? (
          empty(t('Nothing matched that filter.'))
        ) : (
          <Table variant="compact" aria-label={t('Config')}>
            <Thead>
              <Tr>
                <Th width={70}>
                  {feature.configKey
                    ? t('Setting under {{key}}', { key: feature.configKey })
                    : t('Setting')}
                </Th>
                <Th width={30}>{t('Value')}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {configRows.map((entry) => (
                <Tr key={entry.path}>
                  <Td dataLabel={t('Setting')}>
                    <code className="autoshift-console__path">{entry.path}</code>
                  </Td>
                  <Td dataLabel={t('Value')}>
                    <span className="autoshift-console__value">{formatValue(entry.value)}</span>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        ))}

      {view === 'consumers' &&
        (feature.components.length === 0 ? (
          empty(t('No policy on this hub reads these labels.'))
        ) : consumerRows.length === 0 ? (
          empty(t('Nothing matched that filter.'))
        ) : (
          <>
            <Content component="small" className="autoshift-console__muted">
              {t(
                'Components whose Placement reads one of these labels — including components that merely require the feature, not only the one that provides it.',
              )}
            </Content>
            <Table variant="compact" aria-label={t('Consumed by')}>
              <Thead>
                <Tr>
                  <Th width={25}>{t('Component')}</Th>
                  <Th width={40}>{t('Policies')}</Th>
                  <Th width={20}>{t('Sync')}</Th>
                  <Th width={15}>{t('Clusters')}</Th>
                </Tr>
              </Thead>
              <Tbody>
                {consumerRows.map((component) => (
                  <Tr key={component.name}>
                    <Td dataLabel={t('Component')}>{component.name}</Td>
                    {/* The component name is a policy DIRECTORY, and the sync badge beside it is
                        Argo CD's — together they read as an Application and dead-end. The policies
                        it actually delivers are what a reader wants next, so they are listed and
                        linked straight into ACM Governance. */}
                    {/* Plain links, not Labels. A blue chip is what a gating label looks like in
                        the column beside this one, and a policy is not a label; nesting a Link
                        inside a Label also fights the chip's own colours. This matches how the
                        Compliance tab renders a policy name. */}
                    <Td dataLabel={t('Policies')}>
                      {component.policies.length === 0 ? (
                        <span className="autoshift-console__muted">{t('none')}</span>
                      ) : (
                        <div className="autoshift-console__policy-list">
                          {component.policies.map((policy) => (
                            <Link
                              key={policy}
                              to={acmPolicyResultsUrl(policyNamespace, policy)}
                              title={t('Open {{policy}} in ACM Governance', { policy })}
                            >
                              <code className="autoshift-console__path">{policy}</code>
                            </Link>
                          ))}
                        </div>
                      )}
                    </Td>
                    <Td dataLabel={t('Sync')}>
                      <ArgoLabel
                        status={component.syncStatus}
                        placed={component.clusters.length > 0}
                      />
                    </Td>
                    {/* A bare count leaves the obvious next question unanswered. Few enough to
                        read are listed outright; beyond that the count carries the full list in a
                        tooltip, so a large fleet does not turn one cell into a wall of names. */}
                    <Td dataLabel={t('Clusters')}>
                      {component.clusters.length === 0 ? (
                        <span className="autoshift-console__muted">{t('none')}</span>
                      ) : component.clusters.length <= INLINE_CLUSTER_LIMIT ? (
                        component.clusters.join(', ')
                      ) : (
                        <Tooltip content={component.clusters.join(', ')}>
                          <span className="autoshift-console__has-tooltip" tabIndex={0}>
                            {t('{{count}} cluster', { count: component.clusters.length })}
                          </span>
                        </Tooltip>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </>
        ))}
    </div>
  );
};

const FeatureRows: FC<{ feature: FeatureView; rowIndex: number; policyNamespace: string }> = ({
  feature,
  rowIndex,
  policyNamespace,
}) => {
  const { t } = useTranslation('plugin__autoshift-console');
  const [expanded, setExpanded] = useState(false);
  const toggle = () => {
    setExpanded(!expanded);
  };

  return (
    <>
      <Tr isClickable onRowClick={toggle}>
        <Td
          dataLabel={t('Feature')}
          expand={{ rowIndex, isExpanded: expanded, onToggle: toggle }}
        />
        <Td dataLabel={t('Feature')}>
          <span className="autoshift-console__feature">{feature.name}</span>
        </Td>
        <Td dataLabel={t('State')}>
          <ValueLabel name={feature.name} value={feature.value} />
        </Td>
        <Td dataLabel={t('Labels')}>
          {feature.settings.length + (feature.value === undefined ? 0 : 1)}
        </Td>
        <Td dataLabel={t('Config')}>
          {feature.config.length === 0 ? (
            <span className="autoshift-console__muted">—</span>
          ) : (
            <Label isCompact color="blue">
              {t('{{count}} setting', { count: feature.config.length })}
            </Label>
          )}
        </Td>
        <Td dataLabel={t('Consumed by')}>
          {feature.components.length === 0 ? (
            <span className="autoshift-console__muted">—</span>
          ) : (
            feature.components.map((c) => c.name).join(', ')
          )}
        </Td>
      </Tr>
      {expanded && (
        <Tr isExpanded>
          <Td colSpan={6}>
            <FeatureDetail feature={feature} policyNamespace={policyNamespace} />
          </Td>
        </Tr>
      )}
    </>
  );
};

const ClusterSetCard: FC<{
  set: ClusterSetView;
  clusterTypes: Map<string, string | undefined>;
  policyNamespace: string;
}> = ({ set, clusterTypes, policyNamespace }) => {
  const { t } = useTranslation('plugin__autoshift-console');
  const [filter, setFilter] = useState('');

  const needle = filter.trim().toLowerCase();
  const features = needle
    ? set.features.filter(
        (f) =>
          f.name.toLowerCase().includes(needle) ||
          f.settings.some((s) => s.key.toLowerCase().includes(needle)) ||
          f.config.some((c) => c.path.toLowerCase().includes(needle)) ||
          f.components.some((c) => c.name.toLowerCase().includes(needle)),
      )
    : set.features;

  const on = set.features.filter((f) => labelState(f.name, f.value) === 'on').length;

  return (
    <Card className="autoshift-console__stack">
      <CardTitle>
        <Split hasGutter>
          <SplitItem isFilled>{set.name}</SplitItem>
          <SplitItem>
            <Label isCompact color="green">
              {t('{{count}} on', { count: on })}
            </Label>{' '}
            <Label isCompact color="grey">
              {t('{{count}} feature', { count: set.features.length })}
            </Label>{' '}
            <Label isCompact color="blue">
              {t('{{count}} cluster', { count: set.clusters.length })}
            </Label>
          </SplitItem>
        </Split>
      </CardTitle>
      <CardBody>
        {set.clusters.length > 0 && (
          <Content component="p" className="autoshift-console__members">
            {set.clusters
              .map((c) => {
                const type = clusterTypes.get(c);
                return type ? `${c} (${type})` : c;
              })
              .join(', ')}
          </Content>
        )}

        <SearchInput
          placeholder={t('Filter by feature, label, config path or component')}
          value={filter}
          onChange={(_e, value) => {
            setFilter(value);
          }}
          onClear={() => {
            setFilter('');
          }}
          className="autoshift-console__filter"
        />

        {features.length === 0 ? (
          <Content component="p" className="autoshift-console__muted">
            {t('Nothing matched.')}
          </Content>
        ) : (
          <Table variant="compact" aria-label={t('Features in {{name}}', { name: set.name })}>
            <Thead>
              <Tr>
                <Th screenReaderText={t('Expand')} />
                <Th width={20}>{t('Feature')}</Th>
                <Th width={10}>{t('State')}</Th>
                <Th width={10}>{t('Labels')}</Th>
                <Th width={20}>{t('Config')}</Th>
                <Th width={40}>{t('Consumed by')}</Th>
              </Tr>
            </Thead>
            {features.map((feature, i) => (
              <Tbody key={feature.name}>
                <FeatureRows feature={feature} rowIndex={i} policyNamespace={policyNamespace} />
              </Tbody>
            ))}
          </Table>
        )}
      </CardBody>
    </Card>
  );
};

const ClusterSetsPage: FC = () => {
  const { t } = useTranslation('plugin__autoshift-console');

  return (
    <PageFrame title={t('Cluster sets')}>
      {(model) => {
        if (model.clusterSets.length === 0) {
          return (
            <EmptyState titleText={t('No cluster sets')} headingLevel="h4">
              <EmptyStateBody>
                {t('This deployment has no cluster-set ConfigMaps in its policy namespace.')}
              </EmptyStateBody>
            </EmptyState>
          );
        }

        const clusterTypes = new Map(model.clusters.map((c) => [c.name, c.clusterType]));

        return (
          <>
            {model.clusterSets.map((set) => (
              <ClusterSetCard
                key={set.name}
                set={set}
                clusterTypes={clusterTypes}
                policyNamespace={model.deployment.policyNamespace}
              />
            ))}
          </>
        );
      }}
    </PageFrame>
  );
};

export default ClusterSetsPage;
