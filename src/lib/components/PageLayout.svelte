<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';

	let {
		children,
		subtitle,
		headerEnd
	}: {
		children: Snippet;
		subtitle: string;
		headerEnd?: Snippet;
	} = $props();
</script>

<div class="page">
	<header>
		<a href={resolve('/')} class="logo">Swack</a>
		<span class="muted">{subtitle}</span>
		{#if headerEnd}
			{@render headerEnd()}
		{/if}
	</header>
	<main>
		{@render children()}
	</main>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}

	header {
		padding: 1rem 2rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}

	.logo {
		font-size: 1.2rem;
		font-weight: 700;
		color: var(--accent);
	}

	main {
		max-width: 780px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
</style>
