import { test, expect, devices } from '@playwright/test';

const SURVEY_CARD_HEADERS = [
	'Customer Satisfaction Survey',
	'How satisfied are you with our product?',
	'What features would you like to see improved?',
	'Would you recommend our product to a friend?'
];

const SURVEY_CARD_COUNT = SURVEY_CARD_HEADERS.length;

test.use({ ...devices['iPhone 11'] });

test('fills out the survey using swipes on mobile', async ({ page }) => {
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    await page.goto('/survey');
    await page.waitForSelector(`.card h1:has-text("${SURVEY_CARD_HEADERS[0]}")`);
    
    const card = page.locator('.card');
    await expect(card.locator('h1')).toHaveText(SURVEY_CARD_HEADERS[0]);

    // Swipe left for all cards
    for (let i = 0; i < SURVEY_CARD_COUNT; i++) {
        const currentCardHeader = SURVEY_CARD_HEADERS[i];
        await expect(card.locator('h1')).toHaveText(currentCardHeader);
        
        const cardBoundingBox = await card.boundingBox();
        expect(cardBoundingBox).not.toBeNull();

        // Simulate a swipe gesture
        const startPoint = {
            x: cardBoundingBox!.x + cardBoundingBox!.width / 2,
            y: cardBoundingBox!.y + cardBoundingBox!.height / 2
        };
        const endPoint = {
            x: startPoint.x - 200,
            y: startPoint.y
        };
        
        await page.mouse.move(startPoint.x, startPoint.y);
        await page.mouse.down();
        await page.mouse.move(endPoint.x, endPoint.y, { steps: 5 });
        await page.mouse.up();


        if (i < SURVEY_CARD_COUNT - 1) {
            const nextCardHeader = SURVEY_CARD_HEADERS[i + 1];
            await expect(card.locator('h1')).toHaveText(nextCardHeader);
        }
    }

    // Check for the results screen
    await expect(page.locator('.result-card h1')).toHaveText('Thank you!');
    const responses = await page.locator('.result-card li').all();
    expect(responses.length).toBe(SURVEY_CARD_COUNT);

    for (const response of responses) {
        await expect(response).toContainText(': left');
    }
});
