/**
 * Deep links into ACM's Governance UI.
 *
 * These routes are not a published API. They were read off the ACM console plugin's own bundle on
 * a 2.17 hub, where the governance router declares:
 *
 *   /multicloud/governance/policies/details/:namespace/:name
 *   /multicloud/governance/policies/details/:namespace/:name/results
 *   /multicloud/governance/policies/details/:namespace/:name/template/:clusterName/...
 *
 * `/results` is the per-cluster compliance breakdown, and is what ACM's own governance code
 * navigates to when opening a policy — the same breakdown this plugin shows, so a reader following
 * a link from here lands on the matching view rather than a summary they have to drill into again.
 *
 * The `/template/...` route would be a closer target still, since it can address one cluster's copy
 * of a policy, but it needs the apiGroup, version, kind and template name of the inner
 * ConfigurationPolicy. Those are not in `Policy.status`, so reaching them would mean parsing every
 * policy spec — cost that buys one skipped click.
 *
 * If ACM changes these paths the link resolves to ACM's own not-found page. Nothing in this plugin
 * depends on them, so the failure is contained and obvious.
 */

const GOVERNANCE_POLICY_BASE = '/multicloud/governance/policies/details';

/** ACM's per-cluster results view for one Policy. */
export const acmPolicyResultsUrl = (namespace: string, name: string): string =>
  `${GOVERNANCE_POLICY_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/results`;
