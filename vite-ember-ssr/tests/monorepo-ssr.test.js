/**
 * Monorepo SSR regression test for issue #4.
 *
 * The test app depends on `monorepo-lib`, a sibling workspace package
 * that re-exports `tracked` from `@glimmer/tracking`. The vite config
 * forces monorepo-lib external via `ssr.external: ['monorepo-lib']`,
 * simulating what happens with real node_modules packages (like
 * tracked-built-ins) that Vite externalizes by default.
 *
 * Without the fix, when the SSR bundle is loaded at runtime, the
 * external monorepo-lib imports @glimmer/tracking, and pnpm's strict
 * node_modules layout cannot resolve it.
 *
 * The plugin now uses `ssr.noExternal: [/./]` to bundle everything,
 * avoiding runtime resolution failures. This file exists to catch
 * regressions of that fix in the SSR runtime path.
 *
 * See: https://github.com/evoactivity/vite-ember-ssr/issues/4
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createEmberApp, assembleHTML } from 'vite-ember-ssr/server';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const testAppDist = resolve(
  __dirname,
  '../../test-apps/test-app-monorepo-ssr/dist',
);

let template;
let app;

const ssrBundlePath = resolve(testAppDist, 'server/app-ssr.mjs');

beforeAll(async () => {
  template = await readFile(resolve(testAppDist, 'client/index.html'), 'utf-8');
  app = await createEmberApp(ssrBundlePath);
});

afterAll(async () => {
  await app.destroy();
});

describe('Monorepo SSR (issue #4 regression)', () => {
  it('imports the SSR bundle without resolution errors', async () => {
    // If monorepo-lib were left external, this import would fail with:
    //   Cannot find package '@glimmer/tracking' imported from monorepo-lib/...
    const { pathToFileURL } = await import('node:url');
    const appModule = await import(pathToFileURL(ssrBundlePath).href);
    expect(typeof appModule.createSsrApp).toBe('function');
  });

  it('renders a component that imports tracked from the sibling package', async () => {
    const rendered = await app.renderRoute('/');
    const html = assembleHTML(template, rendered);

    expect(rendered.statusCode).toBe(200);
    expect(rendered.error).toBeUndefined();
    expect(html).toContain('data-component="monorepo-status"');
    expect(html).toContain('data-label="monorepo-import-works"');
  });
});
