/**
 * Lazy SSG tests.
 *
 * The unique behaviour of lazy SSG (vs. plain SSG and lazy SSR) is:
 * - The SSG plugin emits a css-manifest.json to disk in the dist output
 *   so a runtime server could load it for non-prerendered routes.
 * - The prerender flow injects lazy CSS <link> tags into the static HTML.
 * - The contact route depends on a 3rd-party package (nvp.ui) that brings
 *   its own CSS, exercising the noExternal CSS extraction path.
 *
 * Generic SSG output and CSS manifest contents are already covered by
 * ssg.test.js and lazy-ssr.test.js.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const lazyDist = resolve(__dirname, '../../test-apps/test-app-lazy-ssg/dist');

let cssManifest;

async function readLazyHtml(route) {
  const filePath =
    route === 'index'
      ? resolve(lazyDist, 'index.html')
      : resolve(lazyDist, route, 'index.html');
  return readFile(filePath, 'utf-8');
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  const raw = await readFile(resolve(lazyDist, 'css-manifest.json'), 'utf-8');
  cssManifest = JSON.parse(raw);
});

// ─── CSS manifest written to disk ────────────────────────────────────

describe('Lazy SSG CSS manifest delivery', () => {
  it('writes css-manifest.json to the client dist', async () => {
    expect(await fileExists(resolve(lazyDist, 'css-manifest.json'))).toBe(true);
  });

  it('includes a 3rd-party package CSS in the contact route entry', () => {
    // contact.gts imports SharedBadge (shared CSS) and nvp.ui (its own CSS).
    // This exercises the ssr.noExternal CSS extraction path for installed
    // packages, which lazy-ssr does not.
    expect(cssManifest.contact.length).toBe(2);
    expect(cssManifest.contact).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/assets\/contact-[a-zA-Z0-9_-]+\.css$/),
        expect.stringMatching(/\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css$/),
      ]),
    );
  });
});

// ─── CSS link injection in prerendered HTML ──────────────────────────

describe('Lazy SSG CSS link injection at prerender time', () => {
  it('injects route CSS links into prerendered <head>', async () => {
    const html = await readLazyHtml('about');
    const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/);
    expect(headMatch).not.toBeNull();

    expect(headMatch[1]).toMatch(
      /<link rel="stylesheet" href="\/assets\/about-[a-zA-Z0-9_-]+\.css">/,
    );
    expect(headMatch[1]).toMatch(
      /<link rel="stylesheet" href="\/assets\/shared-badge-[a-zA-Z0-9_-]+\.css">/,
    );
  });

  it('injects 3rd-party package CSS into the contact route', async () => {
    const html = await readLazyHtml('contact');

    expect(html).toMatch(
      /<link rel="stylesheet" href="\/assets\/contact-[a-zA-Z0-9_-]+\.css">/,
    );
  });

  it('does not inject lazy CSS on eager prerendered routes', async () => {
    const html = await readLazyHtml('index');

    expect(html).not.toMatch(
      /<link rel="stylesheet" href="\/assets\/about-[a-zA-Z0-9_-]+\.css">/,
    );
  });
});
