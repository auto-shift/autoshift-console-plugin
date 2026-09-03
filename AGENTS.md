# AI Agent Instructions for OpenShift Console Plugin Template

This document provides context and guidelines for AI coding assistants working on this codebase.

## Project Overview

This is a **template repository** for creating OpenShift Console dynamic plugins. It's meant to be used via GitHub's "Use this template" feature, NOT forked. The template provides a minimal starting point for extending the OpenShift Console UI with custom pages and functionality.

> **⚠️ WARNING:**
> This repository is used by multiple large-scale enterprise web applications. Please proceed with caution when making any changes to this codebase. Changes here can affect downstream projects that depend on this template.
>
> **Only make changes that should be standard practice for ALL plugins created from this template.** If a change is specific to one plugin use case, it belongs in the instantiated plugin repository, not in this template.

**Key Technologies:**
- TypeScript + React 18
- PatternFly 6 (UI component library)
- webpack with Module Federation
- react-i18next for internationalization
- Playwright for e2e testing
- Helm for deployment

**Compatibility:** Requires OpenShift 4.12+ (uses ConsolePlugin CRD v1 API)

## Architecture & Patterns

### Dynamic Plugin System

This plugin uses module federation to load at runtime into the OpenShift Console. Key files:

- `console-extensions.json`: Declares what the plugin adds to console (routes, nav items, etc.)
- `package.json` `consolePlugin` section: Plugin metadata and exposed modules mapping
- `webpack.config.ts`: Configures module federation and build

**Critical:** Any component referenced in `console-extensions.json` must have a corresponding entry in `package.json` under `consolePlugin.exposedModules`.

### Component Structure

- Use functional components with hooks (NO class components)
- All components should be TypeScript (`.tsx`)
- Follow PatternFly component patterns
- Use PatternFly CSS variables instead of hex colors (dark mode compatibility)

### Styling Constraints

**IMPORTANT:** The `.stylelintrc.yaml` enforces strict rules to prevent breaking console:

- **NO hex colors** - use PatternFly CSS variables (e.g., `var(--pf-v6-global-palette--blue-500)`)
- **NO naked element selectors** (like `table`, `div`) - prevents overwriting console styles
- **NO `.pf-` or `.co-` prefixed classes** - these are reserved for PatternFly and console
- **Prefix all custom classes** with plugin name (e.g., `autoshift-console__nice`)

Don't disable these rules without understanding they protect against layout breakage!

## OpenShift Build Targets

The plugin is built once per OpenShift release, declared in `ocp-targets.json`. This is the single
most important thing to understand before changing dependencies or the build.

The console supplies `react`, `react-router` and `react-i18next` to plugins as **shared
singletons** via module federation, and their versions change between releases — most sharply at
4.22, where the console moved React 17 to 18. A bundle built against the wrong set does not fail
the build. It loads and then fails silently: the pod serves assets, the console skips the plugin,
and every route 404s with nothing in any server-side log. Assume any "the plugin just doesn't
appear" report is this until proven otherwise.

### Layout

```
package.json          build toolchain (webpack, eslint, jest) + the canonical consolePlugin block
yarn.lock             one Dependabot-maintained toolchain tree
ocp-targets.json      the target registry — single source of truth
targets/<minor>/
  package.json        the module-federation contract + everything bundled (react, PatternFly, SDK)
  yarn.lock           that target's pinned tree
  tsconfig.json       generated — paths/typeRoots into this directory
  compat/router.ts    generated — re-exports Link/useSearchParams from what this console shares
src/                  shared source, built once per target
```

Yarn 4 removed `lockfileFilename`, so per-target lockfiles cannot live side by side at the root; a
directory each is the only layout Yarn 4 supports, and the only unit Dependabot can update.

### Rules

- **Never hand-edit anything under `targets/`.** Change `ocp-targets.json`, then run
  `node scripts/sync-targets.mjs`. `src/ocp-targets.spec.ts` runs it in `--check` mode.
- **Never add react, react-router, react-i18next, PatternFly or the SDK to the root
  `package.json`.** They belong to a target. The guard spec fails if one leaks to the root.
- **Select a target with `OCP_TARGET`** (defaults to the newest declared). `yarn build`, `yarn
  test` and `yarn lint` all read it; `scripts/ocp.sh` runs the build from the target directory
  because `ConsoleRemotePlugin` reads `package.json` from the process cwd.
- **Import routing from `@compat/router`, never from `react-router` directly.** `react-router` 5.3
  exports neither `Link` nor `useSearchParams`; on 4.20/4.21 the console shares
  `react-router-dom-v5-compat` instead. Each target's `compat/router.ts` names the shared package
  literally, because module federation matches on the request string — aliasing it would bundle a
  private copy of a singleton.
- **A new React major means checking the test tooling too.** `@testing-library/react` 16 requires
  `react-dom/client`, which does not exist on React 17, so `setup-tests.ts` takes `configure` from
  `@testing-library/dom` instead and the React wrapper is pinned per target.

### Adding a target

1. Add an entry to `ocp-targets.json` (`sdk`, `shared`, `pins`, `routerModule`, `consoleImage`,
   `pluginAPI`). Verify `shared` against the SDK's own peerDependencies:
   `npm view @openshift-console/dynamic-plugin-sdk@<version> peerDependencies`.
2. `node scripts/sync-targets.mjs`
3. Add an npm entry for `/targets/<minor>` to `.github/dependabot.yml`.
4. `(cd targets/<minor> && yarn install)` then `OCP_TARGET=<minor> yarn build`.

The CI, release and rebuild matrices are generated from `ocp-targets.json`, so no workflow edit is
needed. A contract mismatch is reported as "Console provides shared module X but plugin uses Y".

## Internationalization (i18n)

**Namespace Convention:** `plugin__<plugin-name>` (e.g., `plugin__autoshift-console`)

### In React Components:
```tsx
const { t } = useTranslation('plugin__autoshift-console');
return <h1>{t('Hello, World!')}</h1>;
```

### In console-extensions.json:
```json
"name": "%plugin__autoshift-console~My Label%"
```

**After adding/changing messages:** Run `yarn i18n` to update locale files in `/locales`

## File Organization

```
src/
  components/          # React components
    ExamplePage.tsx   # Example page component
    *.css            # Component styles (scoped with plugin prefix)
console-extensions.json # Plugin extension declarations
package.json           # Plugin metadata in consolePlugin section
tsconfig.json          # TypeScript config (strict: false currently)
webpack.config.ts     # Module federation + build config (shared by every target)
locales/               # i18n translation files
charts/                # Helm chart for deployment
integration-tests/     # Playwright e2e tests
```

## Development Workflow

### Local Development
1. `yarn install` - install the root toolchain
2. `(cd targets/<minor> && yarn install)` - install that target's contract tree
3. `export OCP_TARGET=<minor>` - defaults to the newest declared target
4. `yarn start` - starts dev server on port 9001 with CORS
5. `yarn start-console` - runs the console for that target in a container (requires cluster login)
6. Navigate to http://localhost:9000/autoshift

### Code Quality
- `yarn lint` - runs eslint, prettier, and stylelint (with --fix)
- Linting is mandatory before commits
- Follow existing code patterns in the repo

### Testing
- `yarn test` - runs Jest unit tests
- `yarn test-e2e` - opens Playwright in headed mode
- `yarn test-e2e-headless` - runs Playwright in headless mode
- Add e2e tests for new pages/features

## TypeScript Configuration

Current config has `strict: true` and enforces:
- `noUnusedLocals: true`
- All files should use `.tsx` extension

## Common Development Tasks

### Adding a New Page
1. Create component in `src/components/MyPage.tsx`
2. Add to `package.json` `exposedModules`: `"MyPage": "./components/MyPage"`
3. Add route in `console-extensions.json`:
   ```json
   {
     "type": "console.page/route",
     "properties": {
       "path": "/my-page",
       "component": { "$codeRef": "MyPage" }
     }
   }
   ```
4. Optional: Add nav item in `console-extensions.json`
5. Run `yarn i18n` if you added translatable strings

### Adding a Navigation Item
```json
{
  "type": "console.navigation/href",
  "properties": {
    "id": "my-nav-item",
    "name": "%plugin__autoshift-console~My Page%",
    "href": "/my-page",
    "perspective": "acm",
    "section": "autoshift"
  }
}
```

`perspective` is **`acm`**, not `admin`. That is the Fleet management perspective, declared by the
MCE console plugin (`console.perspective`, id `acm`); ACM and MCE tag their own nav with it and this
plugin joins the same way. Every nav item must use it — `plugin-metadata.spec.ts` fails otherwise,
because a single entry left on `admin` lands in a different perspective from its siblings and leaves
a hole in the AutoShift section rather than producing an obvious error.

`console.page/route` takes no `perspective`: routes are global, so `/autoshift/*` resolves from any
perspective. Do not add one.

### Updating Plugin Name
When instantiating from template, update:
1. `package.json` - `name` and `consolePlugin.name`
2. `package.json` - `consolePlugin.displayName` and `description`
3. All i18n namespace references (`plugin__<name>`)
4. CSS class prefixes
5. Helm chart values

## Build & Deployment

### Building Image
```bash
docker build -t quay.io/my-repository/my-plugin:latest .
# For Apple Silicon: add --platform=linux/amd64
```

### Deploying via Helm
```bash
helm upgrade -i my-plugin charts/openshift-console-plugin \
  -n my-namespace \
  --create-namespace \
  --set plugin.image=my-plugin-image-location
```

**Note:** OpenShift 4.10 requires `--set plugin.securityContext.enabled=false`

## Important Constraints & Gotchas

1. **Template, not fork:** Users should use "Use this template", not fork
2. **i18n namespace must match ConsolePlugin resource name** with `plugin__` prefix
3. **CSS class prefixes prevent style conflicts** - always prefix with plugin name
4. **Module federation requires exact module mapping** - `exposedModules` must match `$codeRef` values
5. **PatternFly CSS variables only** - hex colors break dark mode
6. **No HMR for extensions** - changes to `console-extensions.json` require restart
7. **React version follows the target** - 18 on 4.22, 17 on 4.20/4.21. It is not a free choice;
   the console provides it as a shared singleton. See "OpenShift Build Targets" above.

## Extension Points

See [Console Plugin SDK README](https://github.com/openshift/console/tree/master/frontend/packages/console-dynamic-plugin-sdk) for available extension types:

- `console.page/route` - add new pages
- `console.navigation/href` - add nav items
- `console.navigation/section` - add nav sections
- `console.tab` - add tabs to resource pages
- `console.action/provider` - add actions to resources
- `console.flag` - feature flags
- Many more...

## Code Style Preferences

- Functional components with hooks (NO classes)
- TypeScript for all new files
- Use PatternFly components whenever possible
- Keep components focused and composable
- Prefer named exports for components
- Use `React.FC` or explicit return types
- CSS-in-files (not CSS-in-JS)

## Testing Strategy

- **E2E tests (Playwright):** For user flows and page rendering
- **Unit tests (Jest):** For component logic and plugin metadata
- **Test data attributes:** Use `data-test` attributes for selectors (`testIdAttribute` is configured in `playwright.config.ts`)
- Run tests locally before opening PRs

## References

- [Console Plugin SDK](https://github.com/openshift/console/tree/master/frontend/packages/console-dynamic-plugin-sdk)
- [PatternFly React](https://www.patternfly.org/get-started/develop)
- [Dynamic Plugin Enhancement Proposal](https://github.com/openshift/enhancements/blob/master/enhancements/console/dynamic-plugins.md)

## Quick Decision Guide

**When should I...**

- **Use this template?** When creating a NEW OpenShift Console plugin from scratch
- **Add a page?** Update console-extensions.json + exposedModules + create component
- **Style something?** Use PatternFly components and CSS variables, prefix custom classes
- **Add translations?** Use `t()` function, run `yarn i18n` after
- **Test changes?** Run locally with `yarn start` + `yarn start-console`, add Playwright tests
- **Deploy?** Build image, push to registry, install via Helm chart
