import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { useAutoShiftDeployments } from '../../hooks/useAutoShift';
import type { Deployment } from '../../types/autoshift';

export const DEPLOYMENT_PARAM = 'deployment';

/**
 * The selected AutoShift deployment, held in the URL so a link to any page carries the
 * deployment it was viewed under. Falls back to the first discovered deployment.
 */
export const useSelectedDeployment = () => {
  const { deployments, loaded, error, failures } = useAutoShiftDeployments();
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get(DEPLOYMENT_PARAM);
  const selected: Deployment | undefined =
    deployments.find((d) => d.release === requested) ??
    (deployments.length > 0 ? deployments[0] : undefined);

  const setSelected = useCallback(
    (release: string) => {
      const next = new URLSearchParams(searchParams);
      next.set(DEPLOYMENT_PARAM, release);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return { deployments, selected, setSelected, loaded, error, failures };
};

/** Preserve the selected deployment when linking between plugin pages. */
export const withDeployment = (path: string, deployment: Deployment | undefined): string =>
  deployment ? `${path}?${DEPLOYMENT_PARAM}=${encodeURIComponent(deployment.release)}` : path;
