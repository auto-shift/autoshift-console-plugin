import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import type { Configuration } from 'webpack';
import type { Configuration as DevServerConfiguration } from 'webpack-dev-server';

/**
 * webpack rather than rspack, because the build has to be able to target several OpenShift
 * releases. The 4.20-4.22 SDKs support webpack only (DynamicModuleImportPlugin taps webpack hooks
 * rspack does not provide); the 4.23 SDK supports both.
 *
 * One config, several targets. The toolchain is installed at the repo root and the source is
 * shared, but the console's module-federation contract is not: react, react-router and
 * react-i18next are shared singletons whose versions change between releases. Each target owns
 * targets/<minor>/ with its own pinned tree, and scripts/ocp.sh runs this config from there —
 * ConsoleRemotePlugin reads package.json from the process cwd to decide what the bundle asks the
 * console to share. See ocp-targets.json.
 */

// package.json sets "type": "module", so this file is ESM and dirname does not exist.
const dirname = path.dirname(fileURLToPath(import.meta.url));

// scripts/ocp.sh guarantees cwd is the target directory; a bare `webpack` run would not, so fail
// loudly rather than silently building against whatever tree happens to be nearest.
const targetDir = process.cwd();
if (!fs.existsSync(path.join(targetDir, 'compat', 'router.ts'))) {
  throw new Error(
    `webpack must run from a targets/<minor> directory (cwd is ${targetDir}). Use \`yarn build\`, ` +
      'or set OCP_TARGET and go through scripts/ocp.sh.',
  );
}

/*
 * The SDK is pinned per target, so the webpack plugin has to come out of the target's tree rather
 * than be resolved relative to this file. Its own `require`s then resolve from there too, which
 * is how the plugin reads the right SDK peerDependencies — the versions it writes into the
 * bundle's shared-module config.
 */
const requireFromTarget = createRequire(path.join(targetDir, 'package.json'));
const { ConsoleRemotePlugin } = requireFromTarget(
  '@openshift-console/dynamic-plugin-sdk-webpack',
) as typeof import('@openshift-console/dynamic-plugin-sdk-webpack');

const rootPkg = JSON.parse(fs.readFileSync(path.join(dirname, 'package.json'), 'utf-8'));

// The declared pluginAPI range is the one thing in the consolePlugin block that is per target:
// the console skips a plugin whose range excludes it, which is a clean no-op rather than the
// silent module-federation failure an incompatible bundle produces. It is injected from
// ocp-targets.json so the root block stays release-agnostic and there is nothing to keep in step.
const minor = path.basename(targetDir);
const { pluginAPI } = JSON.parse(
  fs.readFileSync(path.join(dirname, 'ocp-targets.json'), 'utf-8'),
).targets[minor];

const isProd = process.env.NODE_ENV === 'production';

const config: Configuration & { devServer?: DevServerConfiguration } = {
  mode: isProd ? 'production' : 'development',
  // No conventional entry point: ConsoleRemotePlugin generates the module-federation entry from
  // the consolePlugin block passed below.
  entry: {},
  context: path.resolve(dirname, 'src'),
  output: {
    path: path.resolve(dirname, 'dist'),
    filename: isProd ? '[name]-bundle-[hash].min.js' : '[name]-bundle.js',
    chunkFilename: isProd ? '[name]-chunk-[chunkhash].min.js' : '[name]-chunk.js',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    // src/ lives at the repo root, so resolving a bare import would walk up into the toolchain
    // tree and miss the target's react entirely. Listing the target's node_modules first is what
    // makes the shared singletons resolve to the versions this release's console provides.
    modules: [path.join(targetDir, 'node_modules'), 'node_modules'],
    alias: {
      // react-router 5.3 exports neither Link nor useSearchParams. Each target directory supplies
      // a compat/router.ts re-exporting them from whichever package that console shares.
      '@compat/router': path.join(targetDir, 'compat', 'router.ts'),
    },
  },
  // Loaders named in a rule are resolved from `context`, which is src/ at the repo root — so the
  // root toolchain's loaders are found, but nothing installed only in the target tree would be.
  // This covers that case. It does NOT cover the SDK's dynamic-module-import-loader, which
  // DynamicModuleImportPlugin appends to a module's loader list after resolution has already
  // happened; that one needs NODE_PATH, set by scripts/ocp.sh.
  resolveLoader: {
    modules: [path.join(targetDir, 'node_modules'), 'node_modules'],
  },
  module: {
    rules: [
      {
        test: /\.(jsx?|tsx?)$/,
        exclude: /\/node_modules\//,
        use: {
          loader: 'swc-loader',
          options: {
            jsc: {
              parser: { syntax: 'typescript', tsx: true },
              transform: {
                react: { runtime: 'automatic' },
              },
              target: 'es2021',
            },
            sourceMaps: true,
          },
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg|woff2?|ttf|eot|otf)(\?.*$|$)/,
        type: 'asset/resource',
        generator: {
          filename: isProd ? 'assets/[contenthash][ext]' : 'assets/[name][ext]',
        },
      },
      {
        test: /\.m?js$/,
        resolve: { fullySpecified: false },
      },
    ],
  },
  devServer: {
    static: './dist',
    port: 9001,
    // Bridge runs in a container and needs to reach this dev server.
    allowedHosts: 'all',
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'X-Requested-With, Content-Type, Authorization',
    },
    devMiddleware: {
      writeToDisk: true,
    },
  },
  plugins: [
    new ConsoleRemotePlugin({
      /*
       * Both passed explicitly, because the plugin would otherwise read them relative to cwd —
       * which is the target directory, not the repo root. Doing it this way also means the
       * consolePlugin block and the extension list exist once, at the root, instead of being
       * copied into every target directory where they could drift.
       */
      pluginMetadata: {
        ...rootPkg.consolePlugin,
        dependencies: { ...rootPkg.consolePlugin.dependencies, '@console/pluginAPI': pluginAPI },
      },
      extensions: JSON.parse(
        fs.readFileSync(path.join(dirname, 'console-extensions.json'), 'utf-8'),
      ),
    }),
    new ForkTsCheckerWebpackPlugin({
      // Each target checks the shared source against its own tree: @types/react 17 against 18,
      // react-router 5 against 7.
      typescript: { configFile: path.join(targetDir, 'tsconfig.json') },
    }),
    new CopyWebpackPlugin({
      patterns: [{ from: path.resolve(dirname, 'locales'), to: 'locales' }],
    }),
  ],
  /*
   * The SDK does not list itself in its own peerDependencies, so ConsoleRemotePlugin sets no
   * requiredVersion for it and webpack falls back to reading one from the nearest package.json to
   * the importing module — which is the root toolchain tree, where the SDK is deliberately not
   * declared. The warning is accurate but the check behind it was never real: the previous
   * single-tree layout satisfied it with "4.22-latest", a dist-tag that is not a valid semver
   * range, so module federation had nothing to compare against either.
   *
   * What actually gates compatibility is consolePlugin.dependencies['@console/pluginAPI'],
   * injected per target above — the console skips a plugin whose range excludes it. Everything
   * else the console shares (react, react-router, react-i18next) still gets a real requiredVersion
   * from the SDK's peerDependencies, and those are the ones that fail silently when wrong.
   */
  ignoreWarnings: [
    {
      message:
        /Unable to find required version for "@openshift-console\/dynamic-plugin-sdk" in description file/,
    },
  ],
  devtool: isProd ? false : 'source-map',
  optimization: {
    chunkIds: isProd ? 'deterministic' : 'named',
    minimize: isProd,
  },
};

export default config;
