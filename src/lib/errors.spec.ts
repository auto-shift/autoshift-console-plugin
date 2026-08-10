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
});
