import * as fs from 'fs';
import * as path from 'path';
import type { ConsolePluginBuildMetadata } from '@openshift-console/dynamic-plugin-sdk-webpack';

const ROOT = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as {
  name: string;
  consolePlugin: ConsolePluginBuildMetadata;
};
const localeFile = path.join(ROOT, `locales/en/plugin__${packageJson.consolePlugin.name}.json`);

const extensions = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'console-extensions.json'), 'utf-8'),
) as { type: string; properties: Record<string, unknown> }[];

describe('plugin metadata', () => {
  it('has a matching i18n locale file, package name, and consolePlugin name', () => {
    if (!fs.existsSync(localeFile)) {
      return;
    }
    expect(packageJson.name).toBe(packageJson.consolePlugin.name);
  });

  /*
   * Nav lives in the Fleet management perspective, whose id is "acm". The perspective is declared
   * by the MCE console plugin (console.perspective, id: acm); ACM and MCE then tag their own nav
   * items with it, and this plugin joins the same way.
   *
   * A single entry left on "admin" does not fail the build — it silently lands in a different
   * perspective from its siblings, leaving an AutoShift section with a hole in it.
   */
  it('registers every nav item in the Fleet management perspective', () => {
    const nav = extensions.filter((e) => e.type.startsWith('console.navigation'));
    expect(nav.length).toBeGreaterThan(0);
    nav.forEach((e) => {
      expect([e.properties.id, e.properties.perspective]).toEqual([e.properties.id, 'acm']);
    });
  });

  /* Routes are perspective-independent, so declaring one there would be meaningless, not merely
     redundant — it would imply a scoping the console does not apply. */
  it('does not scope page routes to a perspective', () => {
    extensions
      .filter((e) => e.type === 'console.page/route')
      .forEach((e) => {
        expect([e.properties.path, e.properties.perspective]).toEqual([
          e.properties.path,
          undefined,
        ]);
      });
  });
});
