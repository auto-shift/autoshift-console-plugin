import { useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import type { K8sResourceCommon, WatchK8sResource } from '@openshift-console/dynamic-plugin-sdk';

/**
 * Typed wrapper around useK8sWatchResource.
 *
 * The SDK declares the data element as non-nullable and the error element as `any`, but a null
 * resource (used to skip a watch until its namespace is known) yields undefined data. This wrapper
 * states that honestly once, so call sites can use `?? []` without fighting the types.
 */
export const useWatch = <R extends K8sResourceCommon | K8sResourceCommon[]>(
  resource: WatchK8sResource | null,
): [R | undefined, boolean, unknown] => {
  // Indexed rather than destructured: destructuring the SDK's `any` error element trips
  // no-unsafe-assignment, while widening it to unknown here keeps call sites type-safe.
  const result = useK8sWatchResource<R>(resource);
  const data: R | undefined = result[0];
  const loaded: boolean = result[1];
  const error: unknown = result[2];
  return [data, loaded, error];
};
