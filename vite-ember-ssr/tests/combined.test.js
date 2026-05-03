/**
 * Combined SSR + SSG mode tests.
 *
 * Combined mode is when both `emberSsr()` and `emberSsg()` are registered.
 * The SSG plugin detects emberSsr and switches its output strategy:
 * - Output goes to dist/client/ alongside the client assets
 * - The original index.html is preserved as _template.html for dynamic SSR
 * - The SSR bundle is built into dist/server/ as usual
 *
 * These tests focus on the combined-mode-specific behaviour. Generic SSR
 * and SSG output is already covered by ssr.test.js and ssg.test.js.
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const combinedDist = resolve(
  __dirname,
  '../../test-apps/test-app-combined/dist',
);
const clientDir = resolve(combinedDist, 'client');
const serverDir = resolve(combinedDist, 'server');

async function readPrerenderedHtml(route) {
  const filePath =
    route === 'index'
      ? resolve(clientDir, 'index.html')
      : resolve(clientDir, route, 'index.html');
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

// ─── Build output structure ──────────────────────────────────────────

describe('Combined mode build output', () => {
  it('places client assets and SSR bundle in separate directories', async () => {
    expect(await fileExists(resolve(clientDir, 'assets'))).toBe(true);
    expect(await fileExists(resolve(serverDir, 'app-ssr.mjs'))).toBe(true);
  });

  it('writes a type:module package.json next to the SSR bundle', async () => {
    const pkgPath = resolve(serverDir, 'package.json');
    expect(await fileExists(pkgPath)).toBe(true);

    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    expect(pkg.type).toBe('module');
  });

  it('cleans up the .ssg-tmp directory after build', async () => {
    expect(await fileExists(resolve(combinedDist, '../.ssg-tmp'))).toBe(false);
  });

  it('preserves index.html as _template.html for dynamic SSR fallback', async () => {
    expect(await fileExists(resolve(clientDir, '_template.html'))).toBe(true);

    const template = await readFile(
      resolve(clientDir, '_template.html'),
      'utf-8',
    );
    expect(template).toContain('<!-- VITE_EMBER_SSR_HEAD -->');
    expect(template).toContain('<!-- VITE_EMBER_SSR_BODY -->');
    expect(template).toMatch(/src="\/assets\/main-[a-zA-Z0-9_-]+\.js"/);
  });
});

// ─── Selective prerendering ──────────────────────────────────────────

describe('Combined mode prerenders only routes listed in the routes option', () => {
  it('emits prerendered HTML for listed routes', async () => {
    expect(await fileExists(resolve(clientDir, 'index.html'))).toBe(true);
    expect(await fileExists(resolve(clientDir, 'about/index.html'))).toBe(true);
    expect(await fileExists(resolve(clientDir, 'contact/index.html'))).toBe(
      true,
    );
  });

  it('does not emit static files for non-prerendered routes', async () => {
    // pokemon-fetch and pokemon-warp-drive were not in the SSG routes list
    expect(
      await fileExists(resolve(clientDir, 'pokemon-fetch/index.html')),
    ).toBe(false);
    expect(
      await fileExists(resolve(clientDir, 'pokemon-warp-drive/index.html')),
    ).toBe(false);
  });
});

// ─── Prerendered HTML emits the same shape as runtime SSR ────────────

describe('Combined mode prerendered HTML', () => {
  it('emits the rehydration shape on prerendered pages', async () => {
    const html = await readPrerenderedHtml('index');
    expect(html).not.toContain('id="ssr-body-start"');
    expect(html).toContain(
      '<script>window.__vite_ember_ssr_rehydrate__=true</script>',
    );
  });
});

// ─── Dynamic SSR fallback (the runtime side of combined mode) ────────

describe('Combined mode dynamic SSR fallback', () => {
  it('the SSR bundle exports createSsrApp', async () => {
    const bundlePath = resolve(serverDir, 'app-ssr.mjs');
    const { pathToFileURL } = await import('node:url');
    const ssrModule = await import(pathToFileURL(bundlePath).href);
    expect(typeof ssrModule.createSsrApp).toBe('function');
  });

  it('renders a non-prerendered route on demand', async () => {
    const { createEmberApp, assembleHTML } =
      await import('vite-ember-ssr/server');
    const bundlePath = resolve(serverDir, 'app-ssr.mjs');
    const template = await readFile(
      resolve(clientDir, '_template.html'),
      'utf-8',
    );

    const dynApp = await createEmberApp(bundlePath);
    try {
      const rendered = await dynApp.renderRoute('/pokemon-fetch', {
        shoebox: true,
      });
      const html = assembleHTML(template, rendered);

      expect(rendered.statusCode).toBe(200);
      expect(html).toContain('data-route="pokemon-fetch"');
      expect(html).toContain('data-pokemon="bulbasaur"');
    } finally {
      await dynApp.destroy();
    }
  });

  it('can also dynamically render a route that has a prerendered version', async () => {
    // Useful to confirm the dynamic fallback path works for any URL,
    // not just the un-prerendered ones.
    const { createEmberApp, assembleHTML } =
      await import('vite-ember-ssr/server');
    const bundlePath = resolve(serverDir, 'app-ssr.mjs');
    const template = await readFile(
      resolve(clientDir, '_template.html'),
      'utf-8',
    );

    const dynApp = await createEmberApp(bundlePath);
    try {
      const rendered = await dynApp.renderRoute('/about');
      const html = assembleHTML(template, rendered);

      expect(rendered.statusCode).toBe(200);
      expect(html).toContain('data-route="about"');
    } finally {
      await dynApp.destroy();
    }
  });
});
