import { Label, Tooltip } from '@patternfly/react-core';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  OutlinedQuestionCircleIcon,
} from '@patternfly/react-icons';
import { useTranslation } from 'react-i18next';
import type { FC, ReactElement } from 'react';
import type { ComplianceCounts } from '../../types/autoshift';

/**
 * Compliance across a set of policy/cluster checks.
 *
 * The number always reads the same way — compliant over total checks — and only the colour
 * changes. An earlier version showed non-compliant/total when red, pending/total when orange and
 * a bare compliant count when green, so the same figure meant three different things depending on
 * a colour the reader had to decode first.
 */
export const ComplianceLabel: FC<{ counts: ComplianceCounts; unknownText: string }> = ({
  counts,
  unknownText,
}) => {
  const { t } = useTranslation('plugin__autoshift-console');
  const total = counts.compliant + counts.nonCompliant + counts.pending;

  if (total === 0) {
    return (
      <Label color="grey" icon={<OutlinedQuestionCircleIcon />}>
        {unknownText}
      </Label>
    );
  }

  const [color, icon] =
    counts.nonCompliant > 0
      ? (['red', <ExclamationCircleIcon key="i" />] as const)
      : counts.pending > 0
        ? (['orange', <ExclamationTriangleIcon key="i" />] as const)
        : (['green', <CheckCircleIcon key="i" />] as const);

  const breakdown = [
    t('{{count}} compliant', { count: counts.compliant }),
    t('{{count}} non-compliant', { count: counts.nonCompliant }),
    t('{{count}} pending', { count: counts.pending }),
  ].join(', ');

  return (
    <Tooltip content={t('{{breakdown}} across {{total}} policy checks', { breakdown, total })}>
      <Label color={color} icon={icon}>
        {counts.compliant} / {total}
      </Label>
    </Tooltip>
  );
};

/**
 * ArgoCD sync/health strings mapped onto PatternFly label colours.
 *
 * `placed` guards the vacuous case. A component whose Placement selects no cluster still reports
 * Synced/Healthy — truthfully, since Argo CD reconciled the Policy object on the hub — but read in
 * a fleet view that green badge claims something is working somewhere, when nothing is running at
 * all. The Argo CD verdict is kept in the tooltip rather than thrown away.
 */
export const ArgoLabel: FC<{ status?: string; placed?: boolean }> = ({ status, placed = true }) => {
  const { t } = useTranslation('plugin__autoshift-console');

  if (!placed) {
    return (
      <Tooltip
        content={
          status
            ? t(
                'No cluster is selected by this component’s Placement. Argo CD reports {{status}}.',
                {
                  status,
                },
              )
            : t('No cluster is selected by this component’s Placement.')
        }
      >
        <Label color="grey" icon={<OutlinedQuestionCircleIcon />}>
          {t('N/A')}
        </Label>
      </Tooltip>
    );
  }

  if (!status) {
    return <Label color="grey">—</Label>;
  }
  const healthy = status === 'Synced' || status === 'Healthy';
  const bad = status === 'Degraded' || status === 'Missing' || status === 'Unknown';
  const color = healthy ? 'green' : bad ? 'red' : 'orange';
  const icon: ReactElement = healthy ? (
    <CheckCircleIcon />
  ) : bad ? (
    <ExclamationCircleIcon />
  ) : (
    <ExclamationTriangleIcon />
  );
  return (
    <Label color={color} icon={icon}>
      {status}
    </Label>
  );
};

export const AvailabilityLabel: FC<{ available: boolean; upText: string; downText: string }> = ({
  available,
  upText,
  downText,
}) =>
  available ? (
    <Label color="green" icon={<CheckCircleIcon />}>
      {upText}
    </Label>
  ) : (
    <Label color="red" icon={<ExclamationCircleIcon />}>
      {downText}
    </Label>
  );
