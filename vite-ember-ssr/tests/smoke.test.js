/**
 * Library invariant smoke tests.
 *
 * For every test app that produces prerendered HTML on disk, assert the
 * library-level invariants that should hold regardless of which app rendered
 * the page. This catches regressions in the rendering pipeline (worker.ts,
 * dev.ts, vite-plugin.ts) that would otherwise need duplicate per-app tests.
 *
 * Per-app behavioural tests (CSS manifest, sibling-package import, dynamic
 * SSR fallback, etc.) live in their dedicated test files.
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const testAppsRoot = resolve(__dirname, '../../test-apps');

/**
 * Each app entry describes one prerendered route from one test app.
 * `dir` is the directory that contains the prerendered files.
 * `route` is the route name used to derive the file path on disk.
 * `expectedRoute` is the data-route attribute we expect to find in the
 *   rendered HTML, proving the right route was picked up.
 */
const apps = [
  {
    name: 'test-app-ssg',
    dir: resolve(testAppsRoot, 'test-app-ssg/dist'),
    route: 'index',
    expectedRoute: 'index',
  },
  {
    name: 'test-app-ssg (about)',
    dir: resolve(testAppsRoot, 'test-app-ssg/dist'),
    route: 'about',
    expectedRoute: 'about',
  },
  {
    name: 'test-app-lazy-ssg',
    dir: resolve(testAppsRoot, 'test-app-lazy-ssg/dist'),
    route: 'index',
    expectedRoute: 'index',
  },
  {
    name: 'test-app-lazy-ssg (about, lazy)',
    dir: resolve(testAppsRoot, 'test-app-lazy-ssg/dist'),
    route: 'about',
    expectedRoute: 'about',
  },
  {
    name: 'test-app-monorepo-ssg',
    dir: resolve(testAppsRoot, 'test-app-monorepo-ssg/dist'),
    route: 'index',
    expectedRoute: 'index',
  },
  {
    name: 'test-app-combined',
    dir: resolve(testAppsRoot, 'test-app-combined/dist/client'),
    route: 'index',
    expectedRoute: 'index',
  },
  {
    name: 'test-app-combined (about)',
    dir: resolve(testAppsRoot, 'test-app-combined/dist/client'),
    route: 'about',
    expectedRoute: 'about',
  },
];

function readHtml(dir, route) {
  const filePath =
    route === 'index'
      ? resolve(dir, 'index.html')
      : resolve(dir, route, 'index.html');
  return readFile(filePath, 'utf-8');
}

describe.each(apps)('Library invariants: $name', ({ dir, route, expectedRoute }) => {
  let html;

  it('reads the prerendered HTML', async () => {
    html = await readHtml(dir, route);
    expect(html.length).toBeGreaterThan(0);
  });

  it('replaces the SSR template markers', () => {
    expect(html).not.toContain('<!-- VITE_EMBER_SSR_HEAD -->');
    expect(html).not.toContain('<!-- VITE_EMBER_SSR_BODY -->');
  });

  it('omits boundary markers (rehydrate output)', () => {
    expect(html).not.toContain('id="ssr-body-start"');
    expect(html).not.toContain('id="ssr-body-end"');
  });

  it('places the rehydrate flag in <head>', () => {
    const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/);
    expect(headMatch).not.toBeNull();
    expect(headMatch[1]).toContain(
      '<script>window.__vite_ember_ssr_rehydrate__=true</script>',
    );
  });

  it('emits Glimmer serialization markers in the body', () => {
    expect(html).toContain('<!--%+b:');
    expect(html).toContain('<!--%-b:');
  });

  it('extracts a <title> into <head>', () => {
    const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/);
    expect(headMatch?.[1]).toMatch(/<title>[^<]+<\/title>/);
  });

  it('references the client JS bundle', () => {
    expect(html).toMatch(/src="\/assets\/[^"]+\.js"/);
  });

  it('rendered the expected route', () => {
    expect(html).toContain(`data-route="${expectedRoute}"`);
  });
});
