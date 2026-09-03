import type { Config } from 'jest';

/**
 * The specs cover the analytical core plus the repo's own invariants, so they are largely
 * target-independent — but the tree they resolve against is not. react, @patternfly and the SDK
 * live in targets/<minor>/node_modules rather than at the root, so the target has to be named.
 *
 * scripts/ocp.sh sets OCP_TARGET and `yarn test` goes through it. A bare `jest` has no target and
 * would otherwise resolve against the toolchain tree, quietly testing something other than what
 * ships — so it stops instead.
 */
const target = process.env.OCP_TARGET;
if (!target) {
  throw new Error(
    'OCP_TARGET is not set. Run `yarn test`, or set it explicitly: OCP_TARGET=4.22 yarn test.',
  );
}

const config: Config = {
  testEnvironment: 'jsdom',
  testRegex: '.*\\.spec\\.(ts|tsx|js|jsx)$',
  // The target's tree first, so a component test renders against the react this release's console
  // provides rather than whatever the toolchain happened to pull in.
  modulePaths: [`<rootDir>/targets/${target}/node_modules`],
  moduleNameMapper: {
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      '<rootDir>/__mocks__/fileMock.ts',
    '\\.css$': '<rootDir>/__mocks__/styleMock.ts',
    // Mirrors resolve.alias in webpack.config.ts — see targets/<minor>/compat/router.ts.
    '^@compat/router$': `<rootDir>/targets/${target}/compat/router.ts`,
  },
  transform: {
    '^.+\\.[jt]sx?$': [
      '@swc/jest',
      {
        module: {
          type: 'commonjs',
          noInterop: true,
        },
        minify: false,
      },
    ],
  },
  setupFilesAfterEnv: ['./setup-tests.ts'],
  testPathIgnorePatterns: ['integration-tests'],
};

export default config;
