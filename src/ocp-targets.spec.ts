import * as fs from 'fs';
import * as path from 'path';
import { load } from 'js-yaml';

const ROOT = path.resolve(__dirname, '..');

const targets = Object.keys(
  (
    JSON.parse(fs.readFileSync(path.join(ROOT, 'ocp-targets.json'), 'utf-8')) as {
      targets: Record<string, unknown>;
    }
  ).targets,
);

const dependabot = load(fs.readFileSync(path.join(ROOT, '.github/dependabot.yml'), 'utf-8')) as {
  updates?: { 'package-ecosystem'?: string; directory?: string }[];
};

const npmUpdatesEnabled = (dependabot.updates ?? []).some(
  (u) => u['package-ecosystem'] === 'npm' && u.directory === '/',
);

/** Lockfiles committed at the repo root, e.g. yarn.lock or yarn-4.23.lock. */
const lockfiles = fs.readdirSync(ROOT).filter((f) => /^yarn(-.+)?\.lock$/.test(f));

/*
 * A second OpenShift target needs a second pinned dependency tree, and Dependabot maintains
 * exactly one: it updates package.json and yarn.lock and nothing else. Any other lockfile drifts
 * with no bot, no build and no test watching it — and the first person to notice is whoever
 * deploys against that target and finds every route 404ing, with nothing in any server log.
 *
 * This is the cheap half of the fix: it does not make multi-target work, it makes breaking the
 * constraint loud. Without it, adding a target to ocp-targets.json fails later and obscurely, in
 * `yarn install --immutable`, as a lockfile-drift error that does not mention targets at all.
 *
 * The real fix is per-target lockfiles plus a per-target Dependabot config — worth doing when
 * multi-target support is actually needed, and not before.
 */
describe('OpenShift build targets', () => {
  it('has a maintained lockfile for every target', () => {
    // Past one target, Dependabot can no longer keep every tree current on its own. Either each
    // target carries its own lockfile AND npm updates are off (every lockfile then refreshed by
    // hand on each bump), or the repo stays on a single target. Both switched on is the state that
    // goes stale silently, and it is the state this asserts against.
    const everyTargetIsMaintained =
      targets.length <= 1 || (lockfiles.length === targets.length && !npmUpdatesEnabled);

    // The inputs ride along in the assertion so a failure names the state it found.
    expect({ targets, lockfiles, npmUpdatesEnabled, everyTargetIsMaintained }).toEqual({
      targets,
      lockfiles,
      npmUpdatesEnabled,
      everyTargetIsMaintained: true,
    });
  });

  it('builds every declared target in CI', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yaml'), 'utf-8');
    // The matrix is generated from ocp-targets.json itself, so every target is built by
    // construction. This asserts that link still exists rather than re-listing the targets.
    expect(ci).toContain('ocp-targets.json');
  });
});
