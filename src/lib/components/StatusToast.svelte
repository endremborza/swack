<script lang="ts">
	interface Props {
		status: 'ok' | 'partial' | 'failed';
		retry?: () => void;
		onDismiss: () => void;
	}

	let { status, retry, onDismiss }: Props = $props();
</script>

<div
	class="answer-toast"
	class:toast-ok={status === 'ok'}
	class:toast-partial={status === 'partial'}
	class:toast-failed={status === 'failed'}
>
	{#if status === 'ok'}
		✓ Recorded
	{:else if status === 'partial'}
		⚠ Partially recorded
	{:else}
		Connection issue — answer may not have been sent
		{#if retry}
			<button class="retry-btn" onclick={retry}>Retry</button>
		{/if}
		<button class="dismiss-btn" onclick={onDismiss}>Dismiss</button>
	{/if}
</div>

<style>
	.answer-toast {
		position: fixed;
		bottom: 1.5rem;
		left: 50%;
		transform: translateX(-50%);
		padding: 0.5rem 1rem;
		border-radius: 8px;
		font-size: 0.8125rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		z-index: 100;
		max-width: calc(100vw - 2rem);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
	}

	.toast-ok {
		background: color-mix(in srgb, var(--success) 15%, var(--surface));
		border: 1px solid color-mix(in srgb, var(--success) 40%, var(--border));
		color: var(--success);
	}

	.toast-partial {
		background: color-mix(in srgb, var(--warning) 15%, var(--surface));
		border: 1px solid color-mix(in srgb, var(--warning) 40%, var(--border));
		color: var(--warning);
	}

	.toast-failed {
		background: color-mix(in srgb, var(--danger) 15%, var(--surface));
		border: 1px solid color-mix(in srgb, var(--danger) 40%, var(--border));
		color: var(--danger);
	}

	.retry-btn,
	.dismiss-btn {
		background: none;
		border: 1px solid currentColor;
		color: inherit;
		font-size: 0.75rem;
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		cursor: pointer;
	}
</style>
