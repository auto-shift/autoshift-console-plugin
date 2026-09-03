#!/usr/bin/env node
/**
 * Write each ocp-targets.json entry into targets/<minor>/.
 *
 * The repo is split along the one axis that actually varies. Build tooling — webpack, eslint,
 * jest, typescript — is target-independent and lives in the root package.json under a single
 * Dependabot-maintained lockfile. Everything that ends up in the bundle, or that
 * ConsoleRemotePlugin reads from the process cwd, gets a directory each under targets/ with its
 * own lockfile, because the console supplies react, react-router and react-i18next as shared
 * singletons whose versions change between releases.
 *
 * Ownership inside a target's package.json is split, and the split is the point:
 *
 *   - this script owns the SDK, `shared` and `pins` versions, and rewrites them from
 *     ocp-targets.json. They are dictated by the console's contract, so a bot must not touch
 *     them — .github/dependabot.yml already ignores every one of them.
 *   - Dependabot owns everything else in the file (PatternFly, and anything added later),
 *     per directory. This script never writes those, so a bump survives a re-run.
 *
 * A key any target pins is removed from every target that does not pin it. That is not tidiness:
 * ConsoleRemotePlugin derives the bundle's shared-module set from the target's declared
 * dependencies rather than from what the source imports, so a pin left behind from another target
 * silently changes what the plugin asks the console to share.
 *
 * src/ocp-targets.spec.ts runs this in --check mode, so a hand edit or a forgotten re-run fails
 * `yarn test` instead of surfacing later as an unexplained mismatch on a cluster.
 *
 * Usage:
 *   node scripts/sync-targets.mjs           # write
 *   node scripts/sync-targets.mjs --check   # exit 1 if anything would change
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'));
const { targets, bundled } = readJson(join(ROOT, 'ocp-targets.json'));
const rootPkg = readJson(join(ROOT, 'package.json'));

const SDK_PACKAGES = [
  '@openshift-console/dynamic-plugin-sdk',
  '@openshift-console/dynamic-plugin-sdk-webpack',
];

/** Every key some target pins, so one target's pin cannot linger in another's tree. */
const contractKeys = new Set([
  ...SDK_PACKAGES,
  ...Object.values(targets).flatMap((t) => [...Object.keys(t.shared), ...Object.keys(t.pins)]),
]);

const minors = Object.keys(targets);
const pkgPathFor = (minor) => join(ROOT, 'targets', minor, 'package.json');

/**
 * Bot-owned versions for a target directory that does not exist yet: taken from the newest target
 * already on disk, falling back to the root package.json on the very first run. Seeding from a
 * sibling rather than a hardcoded list means a new target starts level with the others instead of
 * reintroducing whatever versions were current when this script was written.
 */
const seedBundled = () => {
  const donor = [...minors].reverse().find((m) => existsSync(pkgPathFor(m)));
  const source = donor ? readJson(pkgPathFor(donor)).devDependencies : rootPkg.devDependencies;
  return Object.fromEntries(
    bundled.filter((name) => source?.[name]).map((name) => [name, source[name]]),
  );
};

const pending = [];
const stage = (path, next) => {
  const current = existsSync(path) ? readFileSync(path, 'utf-8') : null;
  if (current !== next) pending.push({ path, next });
};

for (const [minor, spec] of Object.entries(targets)) {
  const dir = join(ROOT, 'targets', minor);
  const pkgPath = pkgPathFor(minor);
  const existing = existsSync(pkgPath) ? readJson(pkgPath) : null;

  const deps = { ...(existing ? existing.devDependencies : seedBundled()) };
  for (const key of contractKeys) delete deps[key];
  for (const name of SDK_PACKAGES) deps[name] = spec.sdk;
  Object.assign(deps, spec.shared, spec.pins);

  const missing = bundled.filter((name) => !deps[name]);
  if (missing.length) {
    console.error(`targets/${minor}: no version known for ${missing.join(', ')}`);
    console.error('add it to an existing target directory first, or to the root package.json.');
    process.exit(1);
  }

  /*
   * No consolePlugin block and no scripts here. ConsoleRemotePlugin reads this file from the
   * process cwd only to decide the shared-module set; webpack.config.ts passes the plugin
   * metadata and the extension list explicitly from the root, so there is one copy of each and
   * nothing to drift.
   */
  stage(
    pkgPath,
    JSON.stringify(
      {
        name: `autoshift-console-ocp${minor}`,
        // Deliberately no version field. Nothing reads it — webpack.config.ts passes the plugin
        // metadata from the root package.json — and copying the root version here would couple
        // these files to it, so the release workflow could not stamp the released version into
        // the root without this script's --check failing in the same run.
        description: `OpenShift ${minor} module-federation contract for ${rootPkg.name}`,
        private: true,
        type: 'module',
        license: rootPkg.license,
        repository: rootPkg.repository,
        devDependencies: Object.fromEntries(
          Object.entries(deps).sort(([a], [b]) => (a < b ? -1 : 1)),
        ),
        packageManager: rootPkg.packageManager,
      },
      null,
      2,
    ) + '\n',
  );

  /*
   * react-router 5.3 exports neither Link nor useSearchParams; on the React 17 releases the
   * console shares react-router-dom-v5-compat, which does. The import has to name the shared
   * package literally — module federation matches on the request string, so re-exporting it
   * under an aliased name would bundle a private copy of a singleton, which loads and then fails
   * silently rather than failing the build.
   */
  stage(
    join(dir, 'compat', 'router.ts'),
    [
      '// GENERATED by scripts/sync-targets.mjs from ocp-targets.json — do not edit.',
      `// OpenShift ${minor} shares '${spec.routerModule}'.`,
      `export { Link, useSearchParams } from '${spec.routerModule}';`,
      '',
    ].join('\n'),
  );

  /*
   * The shared source is type-checked once per target, because the type environment genuinely
   * differs: @types/react 17 against 18, react-router 5 against 7. Bundled packages live in this
   * directory rather than at the root, so `paths` and `typeRoots` both have to point here — TS
   * would otherwise walk up from src/ and find only the toolchain tree.
   */
  stage(
    join(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        extends: '../../tsconfig.json',
        compilerOptions: {
          typeRoots: ['./node_modules/@types', '../../node_modules/@types'],
          paths: {
            '@compat/router': ['./compat/router.ts'],
            ...Object.fromEntries(
              Object.keys(deps)
                .sort()
                .flatMap((name) => [
                  [name, [`./node_modules/${name}`]],
                  [`${name}/*`, [`./node_modules/${name}/*`]],
                ]),
            ),
          },
        },
        include: ['../../src', './compat'],
      },
      null,
      2,
    ) + '\n',
  );

  // Yarn walks up to the root package.json and refuses to treat a nested directory as its own
  // project unless a lockfile marks it as one ("create an empty yarn.lock file in it").
  const lock = join(dir, 'yarn.lock');
  stage(lock, existsSync(lock) ? readFileSync(lock, 'utf-8') : '');
}

if (!pending.length) {
  console.log('targets/ is in sync with ocp-targets.json');
  process.exit(0);
}

if (check) {
  console.error('targets/ is out of sync with ocp-targets.json — run `node scripts/sync-targets.mjs`:');
  for (const { path } of pending) console.error(`  ${path.slice(ROOT.length + 1)}`);
  process.exit(1);
}

for (const { path, next } of pending) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next);
  console.log(`  wrote ${path.slice(ROOT.length + 1)}`);
}
