import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	paths: { base: process.env.NODE_ENV === 'production' ? '/swack' : '' },
	kit: {
		adapter: adapter({ fallback: '404.html' })
	}
};

export default config;
