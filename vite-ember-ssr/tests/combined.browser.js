import { test, expect } from '@playwright/test';

// ─── Static prerendered files served as-is ───────────────────────────

test.describe('Combined mode: prerendered routes serve static HTML', () => {
  test('prerendered route shows content with JS blocked', async ({ page }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/');

    await expect(page.locator('[data-route="index"]')).toBeVisible();
    await expect(
      page.locator('[data-component="counter-display"]'),
    ).toBeVisible();
  });
});

// ─── Dynamic SSR fallback for non-prerendered routes ─────────────────

test.describe('Combined mode: non-prerendered routes use dynamic SSR', () => {
  test('non-prerendered route is rendered on demand with content visible without JS', async ({
    page,
  }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/pokemon-fetch');

    await expect(page.locator('[data-route="pokemon-fetch"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
  });
});

// ─── Client rehydration in both modes ────────────────────────────────

test.describe('Combined mode: client Ember rehydrates regardless of source', () => {
  test('rehydrates a prerendered page', async ({ page }) => {
    await page.goto('/');

    await page.waitForFunction(
      () => document.body.classList.contains('ember-application'),
      { timeout: 15_000 },
    );

    // Counter is interactive after rehydration
    await page.locator('[data-action="increment"]').click();
    await expect(page.locator('[data-count="1"]')).toBeVisible();
  });

  test('rehydrates a dynamically SSR-rendered page', async ({ page }) => {
    await page.goto('/pokemon-fetch');

    await page.waitForFunction(
      () => document.body.classList.contains('ember-application'),
      { timeout: 15_000 },
    );

    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
  });
});

// ─── Routing across the prerender / dynamic boundary ─────────────────

test.describe('Combined mode: client routing crosses prerendered and dynamic routes', () => {
  test('navigates from a prerendered route to a dynamic SSR route', async ({
    page,
  }) => {
    await page.goto('/');

    await page.waitForFunction(
      () => document.body.classList.contains('ember-application'),
      { timeout: 15_000 },
    );

    await page.locator('nav a:has-text("Pokémon (Fetch)")').click();
    await page.waitForURL('/pokemon-fetch', { timeout: 10_000 });

    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible({
      timeout: 10_000,
    });
  });
});
