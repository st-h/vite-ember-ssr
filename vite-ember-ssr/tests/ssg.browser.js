import { test, expect } from '@playwright/test';

// ─── Static HTML is fully present without JS ─────────────────────────

test.describe('SSG static HTML is fully rendered without client JS', () => {
  test('shows prerendered content with fetched data when JS is blocked', async ({
    page,
  }) => {
    await page.route('**/*.js', (route) => route.abort());

    await page.goto('/pokemon-fetch');

    await expect(page.locator('[data-route="pokemon-fetch"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
    await expect(page.locator('[data-pokemon="charmander"]')).toBeVisible();
  });
});

// ─── Client rehydration of static HTML ───────────────────────────────

test.describe('Client Ember rehydrates prerendered HTML', () => {
  test('Ember boots and the counter is interactive after rehydration', async ({
    page,
  }) => {
    await page.goto('/');

    await page.waitForFunction(
      () => document.body.classList.contains('ember-application'),
      { timeout: 15_000 },
    );

    await page.locator('[data-action="increment"]').click();
    await expect(page.locator('[data-count="1"]')).toBeVisible();
  });
});

// ─── Client routing across prerendered pages ─────────────────────────

test.describe('Client-side navigation between prerendered routes', () => {
  test('navigates without a full page reload', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.body.classList.contains('ember-application'),
      { timeout: 15_000 },
    );

    await page.locator('nav a:has-text("About")').click();
    await page.waitForURL('/about', { timeout: 5_000 });
    await expect(page.locator('[data-route="about"]')).toBeVisible();
    await expect(page.locator('[data-route="index"]')).not.toBeAttached();
  });
});

// ─── Shoebox on SSG pages ────────────────────────────────────────────

test.describe('SSG shoebox replays fetches into the client', () => {
  test('no PokeAPI requests on initial load (data served from shoebox)', async ({
    page,
  }) => {
    const pokeApiRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('pokeapi.co')) {
        pokeApiRequests.push(request.url());
      }
    });

    await page.goto('/pokemon-fetch');
    await page.waitForFunction(
      () => document.body.classList.contains('ember-application'),
      { timeout: 15_000 },
    );

    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
    expect(pokeApiRequests).toHaveLength(0);
  });

  test('subsequent client navigation fetches normally', async ({ page }) => {
    const pokeApiRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('pokeapi.co')) {
        pokeApiRequests.push(request.url());
      }
    });

    await page.goto('/pokemon-fetch');
    await page.waitForFunction(
      () => document.body.classList.contains('ember-application'),
      { timeout: 15_000 },
    );
    await expect(page.locator('[data-pokemon="bulbasaur"]')).toBeVisible();
    expect(pokeApiRequests).toHaveLength(0);

    // Navigate to a detail page the shoebox does not have
    await page.locator('[data-pokemon="charmander"] a').click();
    await page.waitForURL('/pokemon-fetch/charmander', { timeout: 10_000 });
    await expect(page.locator('[data-pokemon-name="charmander"]')).toBeVisible({
      timeout: 10_000,
    });

    expect(
      pokeApiRequests.some((url) => url.includes('pokemon/charmander')),
    ).toBe(true);
  });
});
