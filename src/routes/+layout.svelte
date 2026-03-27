<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<style>
	:global(:root) {
		--bg: #0d1117;
		--surface: #161b22;
		--surface2: #21262d;
		--border: #30363d;
		--text: #e6edf3;
		--text-muted: #7d8590;
		--accent: #7c3aed;
		--accent-hover: #6d28d9;
		--success: #22c55e;
		--danger: #ef4444;
		--warning: #f59e0b;
		--info: #3b82f6;
	}

	:global(*, *::before, *::after) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--text);
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
		line-height: 1.5;
		min-height: 100dvh;
	}

	:global(button) {
		cursor: pointer;
		border: none;
		border-radius: 6px;
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		font-family: inherit;
		transition: background 0.15s;
	}

	:global(button.primary) {
		background: var(--accent);
		color: #fff;
	}

	:global(button.primary:hover) {
		background: var(--accent-hover);
	}

	:global(button.ghost) {
		background: transparent;
		color: var(--text-muted);
		border: 1px solid var(--border);
	}

	:global(button.ghost:hover) {
		background: var(--surface2);
		color: var(--text);
	}

	:global(button.danger-btn) {
		background: transparent;
		color: var(--danger);
		border: 1px solid transparent;
		padding: 0.25rem 0.5rem;
	}

	:global(button.danger-btn:hover) {
		background: color-mix(in srgb, var(--danger) 15%, transparent);
	}

	:global(input, textarea) {
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text);
		font-family: inherit;
		font-size: 0.875rem;
		padding: 0.5rem 0.75rem;
		width: 100%;
	}

	:global(input:focus, textarea:focus) {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
	}

	:global(a) {
		color: var(--accent);
		text-decoration: none;
	}

	:global(a:hover) {
		text-decoration: underline;
	}
</style>
