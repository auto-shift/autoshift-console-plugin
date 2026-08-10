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

/** Build a failure entry, or undefined when the watch succeeded. */
export const toFailure = (resource: string, error: unknown): WatchFailure | undefined =>
  error ? { resource, forbidden: isForbidden(error), message: describeError(error) } : undefined;
