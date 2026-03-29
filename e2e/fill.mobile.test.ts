import { test, expect, devices } from '@playwright/test';
import { createTestForm, useMockRelay } from './helpers';

test.use({ ...devices['iPhone 13'] });

test('swipe gesture triggers answer', async ({ page }) => {
	const form = await createTestForm(['Swipe me', 'Next one']);
	await useMockRelay(page, form.configEvent);
	await page.goto(`/fill#${form.pubkey}_${form.configAesKey}`);

	await expect(page.locator('.card .question')).toHaveText('Swipe me', { timeout: 10000 });

	const card = page.locator('.card');
	const box = await card.boundingBox();
	const sx = box!.x + box!.width / 2;
	const sy = box!.y + box!.height / 2;

	// The fill page handles both touch and mouse events; use mouse drag for reliable simulation
	await page.mouse.move(sx, sy);
	await page.mouse.down();
	await page.mouse.move(sx - 150, sy, { steps: 10 });
	await page.mouse.up();

	await expect(page.locator('.card .question')).toHaveText('Next one');
});
