import { test, expect } from '@playwright/test';

test('hero h1', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.hero h1')).toHaveText('Collect feedback with a swipe');
});

test('create form link', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('a.create-btn')).toBeVisible();
	await expect(page.locator('a.create-btn')).toHaveAttribute('href', /\/create/);
});

test('how it works section', async ({ page }) => {
	await page.goto('/');
	const steps = page.locator('.step');
	await expect(steps).toHaveCount(4);
});

test('import section', async ({ page }) => {
	await page.goto('/');
	const summary = page.locator('details summary');
	await expect(summary).toContainText('Import existing form');
});

test('page title', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveTitle('Swack — decentralized swipe surveys');
});
