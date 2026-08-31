<script lang="ts">
	import Landing from '$lib/components/Landing.svelte';
	import Quiz from '$lib/components/Quiz.svelte';

	// A build with VITE_QUIZ_SLUG set is a dedicated quiz deployment: its root is the quiz.
	const quizSlug: string | undefined = import.meta.env.VITE_QUIZ_SLUG;
</script>

{#if quizSlug}
	<Quiz slug={quizSlug} />
{:else}
	<Landing />
{/if}
