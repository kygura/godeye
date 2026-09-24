import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  expandApplicationHtml,
  APPLICATION_TEMPLATES,
} from '../../build/application-html.js';

test('the standalone document expands every component once and preserves unique element ids', () => {
  const source = readFileSync(
    new URL('../../index.html', import.meta.url),
    'utf8',
  );
  // Expansion recurses (a template may itself nest another marker — e.g.
  // context.html nests city-intel so #city-intel-panel lands as a real DOM
  // child of #right-context-rail), so "once each" is counted across index.html
  // plus every template's own raw source, not index.html alone.
  const templateSources = APPLICATION_TEMPLATES.map((name) =>
    readFileSync(
      new URL(`../ui/templates/${name}.html`, import.meta.url),
      'utf8',
    ),
  );
  const totalMarkers = [source, ...templateSources].reduce(
    (sum, text) => sum + [...text.matchAll(/gev:template /g)].length,
    0,
  );
  assert.equal(totalMarkers, APPLICATION_TEMPLATES.length);
  const html = expandApplicationHtml(source);
  assert.doesNotMatch(html, /gev:template/);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /id="cesiumContainer"/);
  assert.match(html, /type="module" src="\/src\/main.js"/);
});

test('component selection includes only requested markup and refuses filesystem traversal', () => {
  const html = expandApplicationHtml('<!-- gev:template welcome -->\n');
  assert.match(html, /id="first-run-launcher"/);
  assert.doesNotMatch(html, /id="cesiumContainer"/);
  assert.throws(
    () => expandApplicationHtml('<!-- gev:template ../../.env -->'),
    /Unknown application template/,
  );
});
