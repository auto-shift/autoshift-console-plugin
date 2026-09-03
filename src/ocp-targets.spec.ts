import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { load } from 'js-yaml';

const ROOT = path.resolve(__dirname, '..');

const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf-8')) as never;

const registry = readJson('ocp-targets.json') as {
  targets: Record<
    string,
    { sdk: string; shared: Record<string, string>; pins: Record<string, string> }
  >;
};
const targets = Object.keys(registry.targets);

const rootPkg = readJson('package.json') as { devDependencies: Record<string, string> };

const dependabot = load(fs.readFileSync(path.join(ROOT, '.github/dependabot.yml'), 'utf-8')) as {
  updates?: { 'package-ecosystem'?: string; directory?: string }[];
};
const npmDirectories = (dependabot.updates ?? [])
  .filter((u) => u['package-ecosystem'] === 'npm')
  .map((u) => u.directory);

/*
 * A plugin bundle cannot span OpenShift releases: the console supplies react, react-router and
 * react-i18next as shared singletons and their versions change between releases. Getting it wrong
 * does not fail the build — the pod serves assets, the console skips the plugin, and every route
 * 404s with nothing in any server-side log. So each target owns a pinned dependency tree, and
 * these tests assert the machinery that keeps those trees honest.
 *
 * The layout is forced rather than chosen. Yarn 4 removed the `lockfileFilename` setting, so
 * per-target lockfiles cannot sit side by side at the repo root; a directory each is the only
 * thing Yarn 4 supports, and the only unit Dependabot can update.
 */
describe('OpenShift build targets', () => {
  it.each(targets)('%s has a directory with its own pinned tree', (minor) => {
    const dir = path.join(ROOT, 'targets', minor);
    const present = ['package.json', 'yarn.lock', 'tsconfig.json', 'compat/router.ts'].filter((f) =>
      fs.existsSync(path.join(dir, f)),
    );
    expect(present).toEqual(['package.json', 'yarn.lock', 'tsconfig.json', 'compat/router.ts']);
  });

  /*
   * Without this, a target's tree drifts with no bot, no build and no test watching it — and the
   * first person to notice is whoever deploys against that target and finds every route 404ing.
   * The root entry covers the toolchain; the per-directory ones cover what actually ships.
   */
  it('has a Dependabot npm entry for the toolchain and every target', () => {
    expect(npmDirectories.sort()).toEqual(['/', ...targets.map((m) => `/targets/${m}`)].sort());
  });

  /*
   * ConsoleRemotePlugin derives the bundle's shared-module set from the dependencies declared in
   * the target's package.json, not from what the source imports. A contract package left in the
   * root toolchain tree would resolve ahead of nothing at all — but it would also let someone
   * bump react at the root and believe they had changed what ships.
   */
  it('keeps every contract package out of the root toolchain tree', () => {
    const contract = new Set(
      Object.values(registry.targets).flatMap((t) => [
        ...Object.keys(t.shared),
        ...Object.keys(t.pins),
      ]),
    );
    const leaked = Object.keys(rootPkg.devDependencies).filter((d) => contract.has(d));
    expect(leaked).toEqual([]);
  });

  /*
   * The generator owns the pins, the SDK line and the router shim in every target directory.
   * Running it in --check mode here means a hand edit, or an ocp-targets.json change without a
   * re-run, fails as a named mismatch rather than as an unexplained shared-module error later.
   */
  it('has targets/ in sync with ocp-targets.json', () => {
    expect(() =>
      execFileSync('node', ['scripts/sync-targets.mjs', '--check'], { cwd: ROOT }),
    ).not.toThrow();
  });

  it('builds every declared target in CI', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yaml'), 'utf-8');
    // The matrix is generated from ocp-targets.json itself, so every target is built by
    // construction. This asserts that link still exists rather than re-listing the targets.
    expect(ci).toContain('ocp-targets.json');
  });
});
