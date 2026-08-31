<script lang="ts">
	import type { LeaderboardEntry } from '$lib/quiz';

	interface Props {
		entries: LeaderboardEntry[];
	}

	let { entries }: Props = $props();

	const MEDALS = ['🥇', '🥈', '🥉'];
</script>

<div class="leaderboard">
	<h3>Leaderboard</h3>
	{#if entries.length === 0}
		<p class="empty">No entries yet.</p>
	{:else}
		{#each entries as e, i}
			<div class="row">
				<span class="rank">{MEDALS[i] ?? `${i + 1}.`}</span>
				<span class="name">{e.name}</span>
				{#if e.points !== undefined}
					<span class="points">{e.points}</span>
				{/if}
			</div>
		{/each}
	{/if}
</div>

<style>
	.leaderboard {
		width: 100%;
		margin-top: 1.5rem;
		text-align: left;
	}

	.leaderboard h3 {
		font-size: 0.8125rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		margin: 0 0 0.75rem;
		text-align: center;
	}

	.empty {
		font-size: 0.875rem;
		color: var(--text-muted);
		text-align: center;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 8px;
		margin-bottom: 0.4rem;
		font-size: 0.9375rem;
	}

	.rank {
		width: 1.75rem;
		text-align: center;
	}

	.name {
		flex: 1;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.points {
		font-weight: 700;
		color: var(--success);
	}
</style>
