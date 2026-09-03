import * as fs from 'fs';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import prettier from 'eslint-plugin-prettier/recommended';
import reactHooks from 'eslint-plugin-react-hooks';
import importX from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import playwright from 'eslint-plugin-playwright';
import jest from 'eslint-plugin-jest';
import testingLibrary from 'eslint-plugin-testing-library';
import globals from 'globals';

/*
 * Type-aware linting needs a TypeScript project, and there is one per OpenShift target rather
 * than one at the root: the type environment genuinely differs between them (@types/react 17
 * against 18, react-router 5 against 7), and the packages themselves live in
 * targets/<minor>/node_modules. Linting always runs from the repo root, so a plain relative read
 * is enough to find the registry.
 */
const { targets } = JSON.parse(fs.readFileSync('ocp-targets.json', 'utf-8')) as {
  targets: Record<string, { shared: { react: string } }>;
};
const minors = Object.keys(targets);
const target = process.env.OCP_TARGET ?? minors[minors.length - 1];
if (!targets[target]) {
  throw new Error(`unknown OCP_TARGET '${target}'; declared targets: ${minors.join(', ')}`);
}

// 'detect' reads react's package.json by resolving it from here, and react is not installed at
// the root — so it has to be stated. The range is the one the target's console provides.
const reactVersion = targets[target].shared.react.replace(/^[^\d]*/, '');

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/'],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  reactHooks.configs.flat['recommended-latest'],
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  {
    settings: {
      // Defaults to the root tsconfig, which maps nothing: react, PatternFly and the SDK all live
      // in the target's tree, and '@compat/router' only exists there. Without this every one of
      // those imports is reported unresolved.
      'import-x/resolver-next': [
        createTypeScriptImportResolver({ project: [`./targets/${target}/tsconfig.json`] }),
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      react,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      '@typescript-eslint/consistent-type-imports': 'error',
    },
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        project: [`./targets/${target}/tsconfig.json`],
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: reactVersion,
      },
    },
  },
  {
    files: ['src/**/*.spec.{ts,tsx}'],
    plugins: {
      ...jest.configs['flat/recommended'].plugins,
      ...jest.configs['flat/style'].plugins,
      ...testingLibrary.configs['flat/react'].plugins,
    },
    languageOptions: {
      ...jest.configs['flat/recommended'].languageOptions,
      ...jest.configs['flat/style'].languageOptions,
      globals: {
        ...globals.jest,
        ...globals.node,
      },
    },
    rules: {
      ...jest.configs['flat/recommended'].rules,
      ...jest.configs['flat/style'].rules,
      ...testingLibrary.configs['flat/react'].rules,
    },
  },
  {
    ...playwright.configs['flat/recommended'],
    files: ['integration-tests/**/*.ts'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      ...tseslint.configs.disableTypeChecked.rules,
      'no-console': 'off',
    },
  },
  prettier,
);
