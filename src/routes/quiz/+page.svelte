<script lang="ts">
	import { onMount } from 'svelte';
	import Quiz from '$lib/components/Quiz.svelte';

	let slug: string | null = $state(null);
	let missing = $state(false);

	onMount(() => {
		const fromHash = window.location.hash.slice(1);
		const resolved = fromHash || import.meta.env.VITE_QUIZ_SLUG;
		if (resolved) slug = resolved;
		else missing = true;
	});
</script>

{#if slug}
	<Quiz {slug} />
{:else if missing}
	<div class="center">
		<p class="muted">No quiz specified — open a quiz link like <code>/quiz#slug</code>.</p>
	</div>
{/if}

<style>
	.center {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		text-align: center;
	}
</style>
