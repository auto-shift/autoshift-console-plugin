/**
 * Reads go through the console's Kubernetes proxy using the viewer's own token, so a user without
 * RBAC gets a 403 rather than data. Distinguishing that from "the resource genuinely does not
 * exist" matters: an empty fleet and an invisible fleet look identical otherwise, and reporting
 * the wrong one would have someone believe their clusters are unconfigured.
 */

/** One watch that failed, named by the resource a reader would recognise. */
export interface WatchFailure {
  /** Human-readable resource description, e.g. "Placements". */
  resource: string;
  forbidden: boolean;
  message: string;
}

interface MaybeHttpError {
  response?: { status?: number };
  status?: number | string;
  code?: number;
  reason?: string;
  message?: string;
  name?: string;
  json?: { code?: number; reason?: string; message?: string };
}

const asError = (error: unknown): MaybeHttpError =>
  typeof error === 'object' && error !== null ? error : {};

/**
 * True when a watch failed because the viewer lacks permission.
 *
 * The console surfaces k8s failures in more than one shape depending on how the request was made,
 * so status is checked in each place it can appear before falling back to the message text.
 */
export const isForbidden = (error: unknown): boolean => {
  if (!error) {
    return false;
  }
  const e = asError(error);
  const codes = [
    e.response?.status,
    typeof e.status === 'number' ? e.status : undefined,
    e.code,
    e.json?.code,
  ];
  if (codes.some((c) => c === 403)) {
    return true;
  }
  if (e.reason === 'Forbidden' || e.json?.reason === 'Forbidden') {
    return true;
  }
  const text = `${e.message ?? ''} ${e.json?.message ?? ''}`.toLowerCase();
  return text.includes('forbidden') || text.includes('is not allowed');
};

export const describeError = (error: unknown): string => {
  const e = asError(error);
  return e.json?.message ?? e.message ?? String(error);
};

/**
 * True when the console has not resolved this resource's model yet.
 *
 * useK8sWatchResource returns `new NoModelError()` whenever the console's model list has loaded but
 * the model for this particular API group has not — a normal window during API discovery, hit by
 * every watch on a CRD group (policy.open-cluster-management.io, argoproj.io,
 * cluster.open-cluster-management.io). Reporting it raises a banner that reads like a permissions
 * failure and then disappears a moment later.
 *
 * Trade-off, deliberately taken: an API group that is genuinely absent produces this same error
 * permanently, and is now silent. That case is already covered — the plugin only deploys to hubs,
 * and PageFrame renders "No AutoShift deployment found" when discovery turns up nothing. A
 * transient false alarm on every page load is the worse failure.
 *
 * NoModelError is not exported from the SDK, so instanceof is unavailable. Its name comes from
 * `new.target.name`, which minification mangles in a production build, so the message literal is
 * matched too — minifiers leave string literals alone.
 */
const isModelNotResolved = (error: unknown): boolean => {
  const e = asError(error);
  return e.name === 'NoModelError' || e.message === 'Model does not exist';
};

/** Build a failure entry, or undefined when the watch succeeded or is still resolving. */
export const toFailure = (resource: string, error: unknown): WatchFailure | undefined =>
  error && !isModelNotResolved(error)
    ? { resource, forbidden: isForbidden(error), message: describeError(error) }
    : undefined;
