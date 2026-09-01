import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({ fallback: '404.html' }),
		// SWACK_BASE overrides the gh-pages default for root-served deployments
		paths: {
			base: process.env.SWACK_BASE ?? (process.env.NODE_ENV === 'production' ? '/swack' : '')
		}
	}
};

export default config;
