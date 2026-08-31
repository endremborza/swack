<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount, onDestroy } from 'svelte';
	import SwipeDeck from '$lib/components/SwipeDeck.svelte';
	import StatusToast from '$lib/components/StatusToast.svelte';
	import { NostrPool, generateKeypair } from '$lib/nostr';
	import { decryptConfig } from '$lib/crypto';
	import { randomName } from '$lib/names';
	import { DEFAULT_CONFIG, type FormConfig, type SwipeDirection } from '$lib/types';

	type Phase = 'loading' | 'naming' | 'surveying' | 'done' | 'error' | 'resume';

	interface SavedFill {
		timestamp: number;
		answers: { qIndex: number; answer: SwipeDirection }[];
	}

	const NAME_KEY = 'swack_name';

	function initName(): string {
		const stored = localStorage.getItem(NAME_KEY);
		if (stored) return stored;
		const fresh = randomName();
		localStorage.setItem(NAME_KEY, fresh);
		return fresh;
	}

	type AnswerToast = { status: 'ok' | 'partial' | 'failed'; retry: () => void } | null;

	let phase: Phase = $state('loading');
	let loadingMsg = $state('Connecting to relay pool…');
	let errorMsg = $state('');
	let config: FormConfig = $state({ ...DEFAULT_CONFIG });
	let relayCount = $state(0);
	let answerToast: AnswerToast = $state(null);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	// displayOrder[i] = index into config.questions for the i-th card shown
	let displayOrder: number[] = $state([]);
	let currentIndex = $state(0);

	let name = $state(initName());
	let editingName = $state(false);
	let nameInput = $state('');

	let aggregateData: { question: string; score: number; votes: number }[] | null = $state(null);
	let aggregateLoading = $state(false);

	let sessionId = crypto.randomUUID();
	let ephemeralPrivkey = generateKeypair().privkeyHex;

	let savedFill: SavedFill | null = $state(null);
	let showReview = $state(false);
	let localAnswers: { qIndex: number; answer: SwipeDirection }[] = [];

	let serverPubkey = '';
	let configAesKey = '';
	let pool: NostrPool | null = null;

	onMount(() => {
		const hash = window.location.hash.slice(1);
		const parts = hash.split('_');
		if (parts.length < 2) {
			errorMsg = 'Invalid share link.';
			phase = 'error';
			return;
		}
		serverPubkey = parts[0];
		configAesKey = parts.slice(1).join('_');

		loadForm();
	});

	onDestroy(() => {
		pool?.destroy();
		if (toastTimer) clearTimeout(toastTimer);
	});

	function shuffled(arr: number[]): number[] {
		const a = [...arr];
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a;
	}

	async function loadForm() {
		pool = new NostrPool();
		pool.onRelayStatusChange = (status) => {
			relayCount = status.filter((r) => r.ok).length;
		};
		await pool.connect();
		relayCount = pool.relayStatus.length; // total count before health check completes

		const stillTryingTimer = setTimeout(() => {
			if (phase === 'loading') loadingMsg = 'Still trying…';
		}, 4000);

		const timeoutTimer = setTimeout(() => {
			if (phase === 'loading') {
				clearTimeout(stillTryingTimer);
				errorMsg =
					'Could not load form. The relay pool may be unreachable, or the form may not exist.';
				phase = 'error';
			}
		}, 8000);

		let configLoaded = false;
		const unsub = pool.subscribeConfig(serverPubkey, async (encryptedContent) => {
			if (configLoaded) return;
			configLoaded = true;
			clearTimeout(stillTryingTimer);
			clearTimeout(timeoutTimer);
			unsub();
			try {
				const json = await decryptConfig(encryptedContent, configAesKey);
				config = { ...DEFAULT_CONFIG, ...JSON.parse(json) };
				if (config.questions.length === 0) {
					errorMsg = 'This form has no questions yet.';
					phase = 'error';
					return;
				}
				const indices = config.questions.map((_, i) => i);
				displayOrder = config.randomizeOrder ? shuffled(indices) : indices;
				const savedStr = localStorage.getItem(`swack_filled_${serverPubkey}`);
				if (savedStr) {
					try {
						savedFill = JSON.parse(savedStr);
					} catch {
						// ignore malformed
					}
				}
				if (savedFill) {
					phase = 'resume';
				} else if (config.nameMode === 'required') {
					nameInput = name;
					phase = 'naming';
				} else {
					phase = 'surveying';
				}
			} catch {
				errorMsg = 'Could not decrypt form config. The link may be malformed.';
				phase = 'error';
			}
		});
	}

	function directionLabel(dir: SwipeDirection): string {
		const labels: Record<SwipeDirection, string> = {
			Left: config.swipeLeftLabel,
			Right: config.swipeRightLabel,
			Up: config.swipeUpLabel,
			Down: config.swipeDownLabel
		};
		return labels[dir] ?? dir;
	}

	function directionColor(dir: SwipeDirection): string {
		return {
			Left: 'var(--danger)',
			Right: 'var(--success)',
			Up: 'var(--info)',
			Down: 'var(--warning)'
		}[dir];
	}

	function fillAgain() {
		localStorage.removeItem(`swack_filled_${serverPubkey}`);
		localAnswers = [];
		savedFill = null;
		showReview = false;
		sessionId = crypto.randomUUID();
		ephemeralPrivkey = generateKeypair().privkeyHex;
		const indices = config.questions.map((_, i) => i);
		displayOrder = config.randomizeOrder ? shuffled(indices) : indices;
		currentIndex = 0;
		if (config.nameMode === 'required') {
			nameInput = name;
			phase = 'naming';
		} else {
			phase = 'surveying';
		}
	}

	function saveName() {
		const trimmed = nameInput.trim();
		if (trimmed) {
			name = trimmed;
			localStorage.setItem(NAME_KEY, trimmed);
		}
		editingName = false;
	}

	function continueFromNaming() {
		const trimmed = nameInput.trim();
		if (!trimmed) return;
		name = trimmed;
		localStorage.setItem(NAME_KEY, trimmed);
		phase = 'surveying';
	}

	function startEditingName() {
		nameInput = name;
		editingName = true;
	}

	function fetchAggregate() {
		if (config.aggregateVisibility !== 'on-completion' || !pool) return;
		aggregateLoading = true;
		const unsub = pool.subscribeAggregate(serverPubkey, async (encrypted) => {
			try {
				const json = await decryptConfig(encrypted, configAesKey);
				const parsed = JSON.parse(json);
				aggregateData = parsed.questions;
			} catch {
				// ignore malformed
			}
			aggregateLoading = false;
			unsub();
		});
		setTimeout(() => {
			if (aggregateLoading) {
				aggregateLoading = false;
				unsub();
			}
		}, 8000);
	}

	function showToast(toast: AnswerToast) {
		if (toastTimer) clearTimeout(toastTimer);
		answerToast = toast;
		if (toast && toast.status !== 'failed') {
			toastTimer = setTimeout(() => {
				answerToast = null;
			}, 2500);
		}
	}

	function handleSwipe(dir: SwipeDirection) {
		if (phase !== 'surveying') return;
		const qIndex = displayOrder[currentIndex] ?? currentIndex;

		// Fire-and-forget: submit runs in background, the deck advances independently
		void submitAnswer(qIndex, dir);
		localAnswers.push({ qIndex, answer: dir });

		if (currentIndex + 1 >= config.questions.length) {
			setTimeout(() => {
				localStorage.setItem(
					`swack_filled_${serverPubkey}`,
					JSON.stringify({ timestamp: Date.now(), answers: localAnswers })
				);
				phase = 'done';
				fetchAggregate();
			}, 400);
			return;
		}
		currentIndex++;
	}

	async function submitAnswer(qIndex: number, answer: SwipeDirection) {
		if (!pool) return;
		const payload = JSON.stringify({
			sessionId,
			name,
			qIndex,
			answer,
			timestamp: Date.now()
		});
		try {
			const result = await pool.publishAnswer(serverPubkey, payload, ephemeralPrivkey);
			const threshold = config.confirmThreshold ?? 2;
			if (result.accepted >= threshold) {
				showToast({ status: 'ok', retry: () => {} });
			} else if (result.accepted > 0) {
				showToast({ status: 'partial', retry: () => {} });
			} else {
				showToast({
					status: 'failed',
					retry: () => {
						void pool?.publishAnswer(serverPubkey, payload, ephemeralPrivkey);
						answerToast = null;
					}
				});
			}
		} catch {
			showToast({
				status: 'failed',
				retry: () => {
					void pool?.publishAnswer(serverPubkey, payload, ephemeralPrivkey);
					answerToast = null;
				}
			});
		}
	}

	const deckLabels = $derived({
		left: config.swipeLeftLabel,
		right: config.swipeRightLabel,
		up: config.swipeUpLabel,
		down: config.swipeDownLabel
	});
</script>

<svelte:head>
	<title>{config.name || 'Swack'}</title>
</svelte:head>

<div class="page">
	{#if phase === 'loading'}
		<div class="center">
			<span class="muted">{loadingMsg}</span>
			{#if relayCount > 0}
				<span class="relay-hint">{relayCount} relays</span>
			{/if}
		</div>
	{:else if phase === 'naming'}
		<div class="center">
			<div class="naming-box">
				{#if config.name}<p class="naming-form-title">{config.name}</p>{/if}
				<h2>What's your name?</h2>
				<input
					class="naming-input"
					type="text"
					bind:value={nameInput}
					placeholder="Your name"
					onkeydown={(e) => e.key === 'Enter' && continueFromNaming()}
				/>
				<button
					class="primary naming-btn"
					onclick={continueFromNaming}
					disabled={!nameInput.trim()}
				>
					Start
				</button>
			</div>
		</div>
	{:else if phase === 'error'}
		<div class="center">
			<div class="error-box">
				<p>{errorMsg}</p>
				<a href={resolve('/')}>← Home</a>
			</div>
		</div>
	{:else if phase === 'resume' && savedFill}
		<div class="center">
			<div class="done-box">
				<h2>You've filled this form before</h2>
				<p class="muted">Last filled {new Date(savedFill.timestamp).toLocaleDateString()}</p>
				{#if showReview}
					<div class="review-list">
						{#each savedFill.answers.sort((a, b) => a.qIndex - b.qIndex) as a}
							<div class="review-row">
								<span class="review-q">{config.questions[a.qIndex] ?? `Q${a.qIndex + 1}`}</span>
								<span class="review-ans" style="color: {directionColor(a.answer)}"
									>{directionLabel(a.answer)}</span
								>
							</div>
						{/each}
					</div>
				{/if}
				<button class="primary" onclick={fillAgain}>Fill again</button>
			</div>
		</div>
	{:else if phase === 'done'}
		<div class="center">
			<div class="done-box">
				<div class="done-icon">✓</div>
				<h2>All done!</h2>
				{#if config.nameMode !== 'disabled'}
					<p class="muted">Your answers have been submitted as <strong>{name}</strong>.</p>
				{/if}
				{#if config.aggregateVisibility === 'on-completion'}
					<div class="aggregate-section">
						{#if aggregateLoading}
							<p class="muted loading-agg">Loading results…</p>
						{:else if aggregateData}
							<h3>Score summary</h3>
							<table class="agg-table">
								<thead>
									<tr>
										<th>#</th>
										<th>Question</th>
										<th>Score</th>
									</tr>
								</thead>
								<tbody>
									{#each aggregateData as row, i}
										<tr>
											<td class="muted">{i + 1}</td>
											<td>{row.question}</td>
											<td class:pos={row.score > 0} class:neg={row.score < 0}>
												{row.score > 0 ? '+' : ''}{row.score}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{:else if phase === 'surveying'}
		<div class="survey">
			<!-- Form name -->
			{#if config.name}
				<div class="form-title">{config.name}</div>
			{/if}

			<!-- Name badge -->
			{#if config.nameMode !== 'disabled'}
				<div class="name-bar">
					{#if editingName}
						<input
							class="name-input"
							bind:value={nameInput}
							onblur={saveName}
							onkeydown={(e) => e.key === 'Enter' && saveName()}
						/>
					{:else}
						<span class="name-text">{name}</span>
						<button class="name-edit" onclick={startEditingName} aria-label="Change name">✎</button>
					{/if}
				</div>
			{/if}

			<SwipeDeck
				labels={deckLabels}
				question={config.questions[displayOrder[currentIndex] ?? currentIndex]}
				index={currentIndex}
				total={config.questions.length}
				onSwipe={handleSwipe}
			/>
		</div>

		{#if answerToast}
			<StatusToast
				status={answerToast.status}
				retry={answerToast.status === 'failed' ? answerToast.retry : undefined}
				onDismiss={() => {
					answerToast = null;
				}}
			/>
		{/if}
	{/if}
</div>

<style>
	.page {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.center {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 1;
	}

	.error-box {
		text-align: center;
		max-width: 400px;
		padding: 2rem;
	}

	.done-box {
		text-align: center;
		max-width: 480px;
		padding: 2rem;
		width: 100%;
	}

	.done-icon {
		font-size: 3rem;
		color: var(--success);
		margin-bottom: 0.5rem;
	}

	.done-box h2 {
		margin: 0 0 0.5rem;
		font-size: 1.5rem;
	}

	.done-box > .muted {
		margin: 0 0 1.5rem;
	}

	.aggregate-section {
		margin-top: 1.5rem;
		text-align: left;
	}

	.aggregate-section h3 {
		font-size: 0.8125rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		margin: 0 0 0.75rem;
	}

	.loading-agg {
		font-size: 0.875rem;
	}

	.agg-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.agg-table th {
		text-align: left;
		color: var(--text-muted);
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--border);
		font-weight: 500;
	}

	.agg-table td {
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--border);
	}

	.pos {
		color: var(--success);
		font-weight: 600;
	}

	.neg {
		color: var(--danger);
		font-weight: 600;
	}

	/* Survey layout */
	.survey {
		position: relative;
		width: 100%;
		max-width: 420px;
		height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		user-select: none;
	}

	/* Form title */
	.form-title {
		position: absolute;
		top: 0.75rem;
		left: 0.75rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-muted);
		z-index: 10;
		max-width: 40%;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Name badge */
	.name-bar {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 20px;
		padding: 0.3rem 0.6rem;
		z-index: 10;
	}

	.name-text {
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.name-edit {
		background: none;
		border: none;
		padding: 0;
		font-size: 0.8rem;
		color: var(--text-muted);
		cursor: pointer;
		line-height: 1;
	}

	.name-input {
		font-size: 0.8rem;
		padding: 0.1rem 0.3rem;
		width: 120px;
		border-radius: 4px;
	}

	.relay-hint {
		display: block;
		font-size: 0.75rem;
		color: var(--text-muted);
		margin-top: 0.4rem;
		opacity: 0.6;
	}

	.naming-box {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		max-width: 320px;
		width: 100%;
		padding: 2rem;
	}

	.naming-form-title {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-muted);
		margin: 0;
	}

	.naming-box h2 {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0;
	}

	.naming-input {
		width: 100%;
		font-size: 1rem;
		padding: 0.6rem 0.75rem;
		border-radius: 8px;
		text-align: center;
	}

	.naming-btn {
		width: 100%;
		font-size: 1rem;
		padding: 0.65rem 1.5rem;
	}

	.review-list {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0.5rem 0;
		max-height: 50dvh;
		overflow-y: auto;
		text-align: left;
	}

	.review-row {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		padding: 0.4rem 0.5rem;
		background: var(--surface2);
		border-radius: 6px;
		font-size: 0.875rem;
	}

	.review-q {
		flex: 1;
		color: var(--text);
	}

	.review-ans {
		font-weight: 600;
		font-size: 0.8125rem;
		white-space: nowrap;
	}
</style>
