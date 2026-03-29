import { test, expect } from '@playwright/test';
import { useMockRelay } from './helpers';

test.beforeEach(async ({ page }) => {
	await useMockRelay(page);
});

test('page loads with form builder sections', async ({ page }) => {
	await page.goto('/create');
	await expect(page.locator('header .muted')).toHaveText('New form');
	await expect(page.locator('input[placeholder="Untitled form"]')).toBeVisible();
	await expect(page.locator('.publish-btn')).toBeVisible();
});

test('publish button disabled with no questions', async ({ page }) => {
	await page.goto('/create');
	await expect(page.locator('.publish-btn')).toBeDisabled();
});

test('publish button enabled after adding a question', async ({ page }) => {
	await page.goto('/create');
	await page.locator('button:has-text("+ Add")').click();
	await expect(page.locator('.publish-btn')).toBeEnabled();
});

test('full create and publish flow', async ({ page }) => {
	await page.goto('/create');

	// Fill in form name
	await page.locator('input[placeholder="Untitled form"]').fill('My Test Form');

	// Add two questions
	await page.locator('button:has-text("+ Add")').click();
	await page.locator('.question-list li:nth-child(1) input').fill('First question?');

	await page.locator('button:has-text("+ Add")').click();
	await page.locator('.question-list li:nth-child(2) input').fill('Second question?');

	// Publish
	await page.locator('.publish-btn').click();

	// Should show done state with share link
	await expect(page.locator('.result-card h2')).toHaveText('Form published', { timeout: 15000 });
	await expect(page.locator('.link-text')).toContainText('/fill#');
});

test('batch import adds questions', async ({ page }) => {
	await page.goto('/create');

	await page.locator('button:has-text("Batch import")').click();
	await page.locator('.batch-area textarea').fill('Question one\nQuestion two\nQuestion three');
	await page.locator('.batch-area button').click();

	await expect(page.locator('.question-list li')).toHaveCount(3);
	await expect(page.locator('.publish-btn')).toBeEnabled();
});

test('admin link on done page', async ({ page }) => {
	await page.goto('/create');
	await page.locator('button:has-text("+ Add")').click();
	await page.locator('.question-list li:nth-child(1) input').fill('Question?');
	await page.locator('.publish-btn').click();

	await expect(page.locator('a.admin-link')).toBeVisible({ timeout: 15000 });
	await expect(page.locator('a.admin-link')).toHaveAttribute('href', /\/admin#/);
});
