import { DocumentTitle, ListPageHeader } from '@openshift-console/dynamic-plugin-sdk';
import {
  Alert,
  Bullseye,
  EmptyState,
  EmptyStateBody,
  List,
  ListItem,
  PageSection,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
} from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import type { FC, ReactNode } from 'react';
import type { Deployment, FleetModel } from '../../types/autoshift';
import type { WatchFailure } from '../../lib/errors';
import { useSelectedDeployment } from './useSelectedDeployment';
import { useFleetModel } from '../../hooks/useAutoShift';

interface PageFrameProps {
  title: string;
  children: (model: FleetModel, deployment: Deployment) => ReactNode;
}

/**
 * Tells the reader which resources they cannot see.
 *
 * Everything here is read with the viewer's own token, so a missing permission looks exactly like
 * missing data. Without this banner a user lacking RBAC on Placements would see an empty component
 * list and reasonably conclude the fleet was unconfigured.
 */
const AccessNotice: FC<{ failures: WatchFailure[] }> = ({ failures }) => {
  const { t } = useTranslation('plugin__autoshift-console');
  if (failures.length === 0) {
    return null;
  }

  const forbidden = failures.filter((f) => f.forbidden);
  const other = failures.filter((f) => !f.forbidden);

  return (
    <>
      {forbidden.length > 0 && (
        <Alert
          variant="info"
          isInline
          title={t('Some AutoShift data is hidden by your permissions')}
          className="autoshift-console__notice"
        >
          {t('Anything below is incomplete. You cannot read:')}
          <List>
            {forbidden.map((f) => (
              <ListItem key={f.resource}>{f.resource}</ListItem>
            ))}
          </List>
        </Alert>
      )}
      {other.length > 0 && (
        <Alert
          variant="warning"
          isInline
          title={t('Some AutoShift data could not be read')}
          className="autoshift-console__notice"
        >
          <List>
            {other.map((f) => (
              <ListItem key={f.resource}>
                {f.resource}: {f.message}
              </ListItem>
            ))}
          </List>
        </Alert>
      )}
    </>
  );
};

/**
 * Shared page shell: resolves the deployment, loads the fleet model, and renders the loading,
 * error and empty states so each page only handles the populated case.
 */
export const PageFrame: FC<PageFrameProps> = ({ title, children }) => {
  const { t } = useTranslation('plugin__autoshift-console');
  const {
    deployments,
    selected,
    setSelected,
    loaded: deploymentsLoaded,
    error: deploymentsError,
    failures: deploymentFailures = [],
  } = useSelectedDeployment();
  const { model, loaded, failures = [] } = useFleetModel(selected);

  const deploymentsForbidden = deploymentFailures.some((f) => f.forbidden);

  const body = (): ReactNode => {
    if (!deploymentsLoaded || (selected && !loaded)) {
      return (
        <Bullseye>
          <Spinner aria-label={t('Loading')} />
        </Bullseye>
      );
    }

    // A hard failure discovering deployments leaves nothing to render, so it is reported instead
    // of the model. Permission failures get their own wording — the data exists, it is just not
    // visible to this user, which is a very different thing to tell someone.
    if (deployments.length === 0) {
      if (deploymentsForbidden) {
        return (
          <EmptyState titleText={t('You do not have access to AutoShift state')} headingLevel="h4">
            <EmptyStateBody>
              {t(
                'This page reads AutoShift ConfigMaps, ManagedClusters and Policies using your own permissions. Your account cannot list them, so nothing can be shown. This is not a statement about whether AutoShift is installed.',
              )}
            </EmptyStateBody>
          </EmptyState>
        );
      }
      if (deploymentsError) {
        return (
          <Alert variant="danger" isInline title={t('Could not read AutoShift state')}>
            {deploymentFailures[0]?.message ?? t('Unknown error')}
          </Alert>
        );
      }
      return (
        <EmptyState titleText={t('No AutoShift deployment found')} headingLevel="h4">
          <EmptyStateBody>
            {t(
              'This cluster has no AutoShift cluster-labels ConfigMaps. The plugin reads hub-side state, so it only has data on a cluster running an AutoShift instance.',
            )}
          </EmptyStateBody>
        </EmptyState>
      );
    }

    if (!model || !selected) {
      return (
        <Bullseye>
          <Spinner aria-label={t('Loading')} />
        </Bullseye>
      );
    }

    // Partial data still renders. Showing what the user can see, clearly marked as incomplete,
    // beats refusing to show anything.
    //
    // model.deployment, not `selected`: the model fills in the tracked revision from this
    // deployment's own Applications, which the deployment-list hook no longer watches for.
    return children(model, model.deployment);
  };

  return (
    <>
      <DocumentTitle>{title}</DocumentTitle>
      <ListPageHeader title={title} />
      {deployments.length > 1 && selected && (
        <PageSection>
          <ToggleGroup aria-label={t('AutoShift deployment')}>
            {deployments.map((d) => (
              <ToggleGroupItem
                key={d.release}
                text={d.version ? `${d.release} · ${d.version}` : d.release}
                buttonId={d.release}
                isSelected={d.release === selected.release}
                onChange={() => {
                  setSelected(d.release);
                }}
              />
            ))}
          </ToggleGroup>
        </PageSection>
      )}
      <PageSection>
        <AccessNotice failures={[...deploymentFailures, ...failures]} />
        {body()}
      </PageSection>
    </>
  );
};
