import { test, expect } from '@playwright/test';
import { createTestForm, useMockRelay } from './helpers';

test('error state on missing hash', async ({ page }) => {
	await page.goto('/fill');
	await expect(page.locator('.error-box')).toBeVisible();
	await expect(page.locator('.error-box')).toContainText('Invalid share link');
});

test('error state on malformed hash', async ({ page }) => {
	await page.goto('/fill#notvalidatall');
	await expect(page.locator('.error-box')).toBeVisible();
});

test('survey loads and shows first question', async ({ page }) => {
	const form = await createTestForm(['Is this working?', 'Are you sure?']);
	await useMockRelay(page, form.configEvent);
	await page.goto(`/fill#${form.pubkey}_${form.configAesKey}`);

	await expect(page.locator('.card .question')).toHaveText('Is this working?', { timeout: 10000 });
	await expect(page.locator('.progress')).toHaveText('1 / 2');
});

test('keyboard navigation advances through questions', async ({ page }) => {
	const questions = ['Q1', 'Q2', 'Q3'];
	const form = await createTestForm(questions);
	await useMockRelay(page, form.configEvent);
	await page.goto(`/fill#${form.pubkey}_${form.configAesKey}`);

	await expect(page.locator('.card .question')).toHaveText('Q1', { timeout: 10000 });

	await page.keyboard.press('ArrowRight');
	await expect(page.locator('.progress')).toHaveText('2 / 3');
	await expect(page.locator('.card .question')).toHaveText('Q2');

	await page.keyboard.press('ArrowLeft');
	await expect(page.locator('.progress')).toHaveText('3 / 3');
	await expect(page.locator('.card .question')).toHaveText('Q3');

	await page.keyboard.press('ArrowRight');
	await expect(page.locator('.done-box')).toBeVisible();
	await expect(page.locator('.done-box h2')).toHaveText('All done!');
});

test('direction buttons navigate through questions', async ({ page }) => {
	const form = await createTestForm(['First', 'Second']);
	await useMockRelay(page, form.configEvent);
	await page.goto(`/fill#${form.pubkey}_${form.configAesKey}`);

	await expect(page.locator('.card .question')).toHaveText('First', { timeout: 10000 });

	await page.locator('.btn-dir.btn-right').click();
	await expect(page.locator('.card .question')).toHaveText('Second');

	await page.locator('.btn-dir.btn-right').click();
	await expect(page.locator('.done-box h2')).toHaveText('All done!');
});

test('up direction button works when enabled', async ({ page }) => {
	const form = await createTestForm(['Q1', 'Q2'], { swipeUpLabel: 'skip' });
	await useMockRelay(page, form.configEvent);
	await page.goto(`/fill#${form.pubkey}_${form.configAesKey}`);

	await expect(page.locator('.card .question')).toHaveText('Q1', { timeout: 10000 });

	await page.locator('.btn-dir.btn-up').click();
	await expect(page.locator('.card .question')).toHaveText('Q2');
});

test('disabled down direction hides button', async ({ page }) => {
	const form = await createTestForm(['Q1'], { swipeDownLabel: '' });
	await useMockRelay(page, form.configEvent);
	await page.goto(`/fill#${form.pubkey}_${form.configAesKey}`);

	await expect(page.locator('.card')).toBeVisible({ timeout: 10000 });
	await expect(page.locator('.btn-dir.btn-down')).not.toBeVisible();
});

test('name required mode shows naming screen', async ({ page }) => {
	const form = await createTestForm(['Q1'], { nameMode: 'required' });
	await useMockRelay(page, form.configEvent);
	await page.goto(`/fill#${form.pubkey}_${form.configAesKey}`);

	await expect(page.locator('.naming-box h2')).toHaveText("What's your name?", { timeout: 10000 });
	await page.locator('.naming-input').fill('Alice');
	await page.locator('.naming-btn').click();

	await expect(page.locator('.card .question')).toHaveText('Q1');
});

