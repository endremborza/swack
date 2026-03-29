import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'npm run dev -- --port 4175',
		port: 4175,
		reuseExistingServer: true,
		timeout: 60000,
	},
	testDir: 'e2e',
	timeout: 30000,
	expect: { timeout: 10000 },
	use: {
		baseURL: 'http://localhost:4175',
		actionTimeout: 10000,
	}
});
