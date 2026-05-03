/**
 * Monorepo SSG regression test for issue #4.
 *
 * This is the SSG variant of the monorepo issue #4 fix. The SSG flow
 * runs an internal SSR child build via vite.build() before prerendering,
 * which is a separate code path from the production SSR build. This file
 * exists to confirm the fix applies to that child build too.
 *
 * If the SSG child build had not bundled monorepo-lib, prerendering
 * would have crashed and no HTML files would exist.
 *
 * See: https://github.com/evoactivity/vite-ember-ssr/issues/4
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ssgDist = resolve(
  __dirname,
  '../../test-apps/test-app-monorepo-ssg/dist',
);

async function readSsgHtml(route) {
  const filePath =
    route === 'index'
      ? resolve(ssgDist, 'index.html')
      : resolve(ssgDist, route, 'index.html');
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

describe('Monorepo SSG (issue #4 regression)', () => {
  it('prerendered HTML exists for the routes (proves the SSG child build did not crash)', async () => {
    expect(await fileExists(resolve(ssgDist, 'index.html'))).toBe(true);
    expect(await fileExists(resolve(ssgDist, 'about/index.html'))).toBe(true);
  });

  it('prerendered HTML contains the component that imports from the sibling package', async () => {
    const html = await readSsgHtml('index');
    expect(html).toContain('data-component="monorepo-status"');
    expect(html).toContain('data-label="monorepo-import-works"');
  });
});
