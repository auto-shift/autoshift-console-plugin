import { acmPolicyResultsUrl } from './acm';

describe('acmPolicyResultsUrl', () => {
  it('builds the ACM Governance results route for a policy', () => {
    expect(acmPolicyResultsUrl('policies-autoshift', 'policy-storage-cluster')).toBe(
      '/multicloud/governance/policies/details/policies-autoshift/policy-storage-cluster/results',
    );
  });

  /*
   * Namespace and name are Kubernetes names, so they cannot contain a slash — but they are
   * interpolated straight into a route, and an unescaped value would silently redirect somewhere
   * else rather than fail. Encoding costs nothing and removes the class of bug.
   */
  it('encodes each segment', () => {
    expect(acmPolicyResultsUrl('ns/../evil', 'a b')).toBe(
      '/multicloud/governance/policies/details/ns%2F..%2Fevil/a%20b/results',
    );
  });
});
