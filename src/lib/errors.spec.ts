import { describeError, isForbidden, toFailure } from './errors';

describe('isForbidden', () => {
  // The console surfaces k8s failures in several shapes depending on how the request was issued,
  // so each is covered: misreading one as a generic error would show "no data" to a user who is
  // actually just missing RBAC.
  it.each([
    ['fetch-style response status', { response: { status: 403 } }],
    ['flat status', { status: 403 }],
    ['k8s Status body', { json: { code: 403, reason: 'Forbidden' } }],
    ['top-level reason', { reason: 'Forbidden' }],
    ['message text', { message: 'configmaps is forbidden: User cannot list resource' }],
    ['RBAC phrasing', { message: 'User "dev" is not allowed to list placements' }],
  ])('detects %s', (_name, error) => {
    expect(isForbidden(error)).toBe(true);
  });

  it.each([
    ['no error', undefined],
    ['null', null],
    ['not found', { response: { status: 404 } }],
    ['server error', { json: { code: 500, message: 'internal error' } }],
    ['network failure', { message: 'Failed to fetch' }],
  ])('does not misreport %s as forbidden', (_name, error) => {
    expect(isForbidden(error)).toBe(false);
  });
});

describe('describeError', () => {
  it('prefers the k8s status message over the transport message', () => {
    expect(
      describeError({ message: 'Bad Request', json: { message: 'placements.x is forbidden' } }),
    ).toBe('placements.x is forbidden');
  });

  it('falls back to the plain message', () => {
    expect(describeError({ message: 'Failed to fetch' })).toBe('Failed to fetch');
  });
});

describe('toFailure', () => {
  it('returns nothing when the watch succeeded', () => {
    expect(toFailure('Placements', undefined)).toBeUndefined();
    expect(toFailure('Placements', null)).toBeUndefined();
  });

  it('names the resource so the UI can say what is hidden', () => {
    expect(toFailure('Placements', { response: { status: 403 }, message: 'nope' })).toEqual({
      resource: 'Placements',
      forbidden: true,
      message: 'nope',
    });
  });

  it('marks a non-permission failure as such', () => {
    const failure = toFailure('Policies', { response: { status: 500 }, message: 'boom' });
    expect(failure?.forbidden).toBe(false);
  });

  /*
   * The console returns NoModelError for the window between "models loaded" and "this CRD group's
   * model resolved", which every watch on an ACM or Argo CD group passes through on page load.
   * Reporting it flashed a banner reading like a permissions failure, then cleared itself.
   *
   * Both shapes are covered because the constructor name does not survive minification in a
   * production build, while the message literal does.
   */
  it.each([
    ['constructor name', { name: 'NoModelError', message: 'Model does not exist' }],
    ['minified, message only', { name: 't', message: 'Model does not exist' }],
  ])('treats an unresolved model (%s) as still loading, not a failure', (_name, error) => {
    expect(toFailure('Policies', error)).toBeUndefined();
  });

  it('still reports a real error whose message merely mentions a model', () => {
    expect(toFailure('Policies', { message: 'Model does not exist yet, retrying' })).toEqual({
      resource: 'Policies',
      forbidden: false,
      message: 'Model does not exist yet, retrying',
    });
  });
});
