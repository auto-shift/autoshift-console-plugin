import * as path from 'path';
import { fileURLToPath } from 'url';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import { ConsoleRemotePlugin } from '@openshift-console/dynamic-plugin-sdk-webpack';
import type { Configuration } from 'webpack';
import type { Configuration as DevServerConfiguration } from 'webpack-dev-server';

/**
 * webpack rather than rspack, because the build has to be able to target several OpenShift
 * releases. The 4.22 SDK supports webpack only (its DynamicModuleImportPlugin taps webpack hooks
 * rspack does not provide); the 4.23 SDK supports both. Using webpack throughout means the only
 * thing that varies per OCP target is the set of shared-module versions in package.json, which is
 * what ocp-targets.json drives.
 */

// package.json sets "type": "module", so this file is ESM and dirname does not exist.
const dirname = path.dirname(fileURLToPath(import.meta.url));

const isProd = process.env.NODE_ENV === 'production';

const config: Configuration & { devServer?: DevServerConfiguration } = {
  mode: isProd ? 'production' : 'development',
  // No conventional entry point: ConsoleRemotePlugin generates the module-federation entry from
  // the consolePlugin block in package.json.
  entry: {},
  context: path.resolve(dirname, 'src'),
  output: {
    path: path.resolve(dirname, 'dist'),
    filename: isProd ? '[name]-bundle-[hash].min.js' : '[name]-bundle.js',
    chunkFilename: isProd ? '[name]-chunk-[chunkhash].min.js' : '[name]-chunk.js',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
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
    new ConsoleRemotePlugin(),
    new ForkTsCheckerWebpackPlugin({
      typescript: { configFile: path.resolve(dirname, 'tsconfig.json') },
    }),
    new CopyWebpackPlugin({
      patterns: [{ from: path.resolve(dirname, 'locales'), to: 'locales' }],
    }),
  ],
  devtool: isProd ? false : 'source-map',
  optimization: {
    chunkIds: isProd ? 'deterministic' : 'named',
    minimize: isProd,
  },
};

export default config;
