import { test, expect } from '@playwright/test';

const SURVEY_CARD_HEADERS = [
	'Customer Satisfaction Survey',
	'How satisfied are you with our product?',
	'What features would you like to see improved?',
	'Would you recommend our product to a friend?'
];

const SURVEY_CARD_COUNT = SURVEY_CARD_HEADERS.length;

test.describe('Survey page', () => {
	test('fills out the survey using keyboard', async ({ page }) => {
		await page.goto('/survey');
		await page.waitForSelector(`.card h1:has-text("${SURVEY_CARD_HEADERS[0]}")`);
		// Wait for the first card to be visible
		await expect(page.locator('.card h1')).toHaveText(SURVEY_CARD_HEADERS[0]);

		// Respond to all cards with ArrowRight
		for (let i = 0; i < SURVEY_CARD_COUNT; i++) {
			const currentCardHeader = SURVEY_CARD_HEADERS[i];
			await expect(page.locator('.card h1')).toHaveText(currentCardHeader);
			
			await page.keyboard.press('ArrowRight');
			
			if (i < SURVEY_CARD_COUNT - 1) {
				const nextCardHeader = SURVEY_CARD_HEADERS[i + 1];
				await expect(page.locator('.card h1')).toHaveText(nextCardHeader);
			}
		}

		// Check for the results screen
		await expect(page.locator('.result-card h1')).toHaveText('Thank you!');
		const responses = await page.locator('.result-card li').all();
		expect(responses.length).toBe(SURVEY_CARD_COUNT);

		for (const response of responses) {
			await expect(response).toContainText(': right');
		}
	});

	test('reloads and verifies survey resets', async ({ page }) => {
		await page.goto('/survey');
		await page.waitForSelector(`.card h1:has-text("${SURVEY_CARD_HEADERS[0]}")`);
		await expect(page.locator('.card h1')).toHaveText(SURVEY_CARD_HEADERS[0]);

		// Answer one question
		await page.keyboard.press('ArrowUp');
		await expect(page.locator('.card h1')).toHaveText(SURVEY_CARD_HEADERS[1]);

		// Reload the page
		await page.reload();

		// The survey should be back to the first card
		await expect(page.locator('.card h1')).toHaveText(SURVEY_CARD_HEADERS[0]);

		// Answer one question again
		await page.keyboard.press('ArrowDown');
		await expect(page.locator('.card h1')).toHaveText(SURVEY_CARD_HEADERS[1]);
	});
});