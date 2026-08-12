import { useMemo, useState } from 'react';
import { Content, Label, SearchInput, ToggleGroup, ToggleGroupItem } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { FC } from 'react';
import type { PolicyCheck } from '../../types/autoshift';
import { acmPolicyResultsUrl } from '../../lib/acm';

import '../autoshift.css';

const VerdictLabel: FC<{ compliant?: string }> = ({ compliant }) => {
  const { t } = useTranslation('plugin__autoshift-console');
  if (compliant === 'Compliant') {
    return (
      <Label isCompact color="green">
        {t('Compliant')}
      </Label>
    );
  }
  if (compliant === 'NonCompliant') {
    return (
      <Label isCompact color="red">
        {t('Non-compliant')}
      </Label>
    );
  }
  return (
    <Label isCompact color="orange">
      {compliant ?? t('Pending')}
    </Label>
  );
};

/**
 * The individual policy verdicts behind a compliance figure.
 *
 * A count alone cannot answer the two questions people actually have — which policy failed, and on
 * which cluster — so both are always columns here, including on a single-cluster view where the
 * cluster column looks redundant until a second cluster joins the set.
 */
export const ComplianceDetail: FC<{
  checks: PolicyCheck[];
  /**
   * Namespace the policies live in, for the deep link into ACM's Governance UI. Every policy in a
   * given check set belongs to one AutoShift deployment, so it is a single value rather than a
   * per-row field.
   */
  policyNamespace: string;
  /** Hide the cluster column where every row is the same cluster by construction. */
  showCluster?: boolean;
}> = ({ checks, policyNamespace, showCluster = true }) => {
  const { t } = useTranslation('plugin__autoshift-console');
  const [filter, setFilter] = useState('');
  const [only, setOnly] = useState<'problems' | 'all'>('problems');

  const problems = useMemo(() => checks.filter((c) => c.compliant !== 'Compliant'), [checks]);

  const rows = useMemo(() => {
    const base = only === 'problems' ? problems : checks;
    const needle = filter.trim().toLowerCase();
    if (!needle) {
      return base;
    }
    return base.filter(
      (c) => c.policy.toLowerCase().includes(needle) || c.cluster.toLowerCase().includes(needle),
    );
  }, [checks, problems, only, filter]);

  if (checks.length === 0) {
    return (
      <Content component="p" className="autoshift-console__muted">
        {t('No policy has reported on this yet.')}
      </Content>
    );
  }

  return (
    <div className="autoshift-console__detail">
      <div className="autoshift-console__detail-controls">
        <ToggleGroup aria-label={t('Filter policy verdicts')}>
          <ToggleGroupItem
            text={t('Needs attention ({{count}})', { count: problems.length })}
            buttonId="problems"
            isSelected={only === 'problems'}
            onChange={() => {
              setOnly('problems');
            }}
          />
          <ToggleGroupItem
            text={t('All ({{count}})', { count: checks.length })}
            buttonId="all"
            isSelected={only === 'all'}
            onChange={() => {
              setOnly('all');
            }}
          />
        </ToggleGroup>
        <SearchInput
          placeholder={t('Filter by policy or cluster')}
          value={filter}
          onChange={(_e, value) => {
            setFilter(value);
          }}
          onClear={() => {
            setFilter('');
          }}
        />
      </div>

      {rows.length === 0 ? (
        <Content component="p" className="autoshift-console__muted">
          {only === 'problems'
            ? t('Everything reporting is compliant.')
            : t('Nothing matched that filter.')}
        </Content>
      ) : (
        <Table variant="compact" aria-label={t('Policy verdicts')}>
          <Thead>
            <Tr>
              <Th width={showCluster ? 50 : 70}>{t('Policy')}</Th>
              {showCluster && <Th width={30}>{t('Cluster')}</Th>}
              <Th width={20}>{t('Verdict')}</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((c) => (
              <Tr key={`${c.policy}/${c.cluster}`}>
                {/* Deep link to ACM Governance. Both plugins live in the Fleet management
                    perspective, so this is an in-app route change, not a page load. */}
                <Td dataLabel={t('Policy')}>
                  <Link
                    to={acmPolicyResultsUrl(policyNamespace, c.policy)}
                    title={t('Open {{policy}} in ACM Governance', { policy: c.policy })}
                  >
                    <code className="autoshift-console__path">{c.policy}</code>
                  </Link>
                </Td>
                {showCluster && <Td dataLabel={t('Cluster')}>{c.cluster}</Td>}
                <Td dataLabel={t('Verdict')}>
                  <VerdictLabel compliant={c.compliant} />
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </div>
  );
};
