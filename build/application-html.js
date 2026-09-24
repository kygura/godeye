import { readFileSync } from 'node:fs';

export const APPLICATION_TEMPLATES = Object.freeze([
  'scene-chrome',
  'cockpit',
  'display-controls',
  'command-dock',
  'layer-panels',
  'context',
  'welcome',
  'provider-settings',
  'hud-loading',
  'travel',
  'city-intel',
]);
const allowed = new Set(APPLICATION_TEMPLATES);

/**
 * Expand only known component templates; markers cannot name filesystem
 * paths. Recursive so an included template may itself nest another marker
 * (context.html nests city-intel so `#city-intel-panel` lands as a real DOM
 * child of `#right-context-rail`, sharing its flex/collapse rail CSS).
 */
export function expandApplicationHtml(html) {
  return html.replace(
    /^[ \t]*<!-- gev:template ([^\s]+) -->\r?\n?/gm,
    (_, name) => {
      if (!allowed.has(name))
        throw new Error(`Unknown application template: ${name}`);
      const content = readFileSync(
        new URL(`../src/ui/templates/${name}.html`, import.meta.url),
        'utf8',
      );
      return expandApplicationHtml(content);
    },
  );
}

/** Assemble static application markup before Vite processes scripts and assets. */
export function applicationHtmlPlugin() {
  return {
    name: 'application-component-templates',
    transformIndexHtml: {
      order: 'pre',
      handler: expandApplicationHtml,
    },
  };
}
