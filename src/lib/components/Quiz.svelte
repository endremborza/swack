<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import SwipeDeck from './SwipeDeck.svelte';
	import StatusToast from './StatusToast.svelte';
	import Leaderboard from './Leaderboard.svelte';
	import {
		getLeaderboard,
		getQuizConfig,
		getSession,
		postAnswer,
		type LeaderboardEntry,
		type QuizPublicConfig
	} from '$lib/quiz';
	import {
		clearProgress,
		loadProgress,
		mergeServerAnswers,
		newProgress,
		reconcileProgress,
		remainingOf,
		saveProgress,
		type QuizProgress
	} from '$lib/progress';
	import { randomName } from '$lib/names';
	import type { SwipeDirection } from '$lib/types';

	interface Props {
		slug: string;
	}

	let { slug }: Props = $props();

	type Phase = 'loading' | 'error' | 'naming' | 'resume' | 'surveying' | 'done';

	const NAME_KEY = 'swack_name';

	let phase: Phase = $state('loading');
	let errorMsg = $state('');
	let config = $state<QuizPublicConfig | null>(null);
	let progress = $state<QuizProgress | null>(null);
	let nameInput = $state('');
	let toast: { status: 'ok' | 'failed'; retry?: () => void } | null = $state(null);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	let leaderboard: LeaderboardEntry[] | null = $state(null);
	let showBoard = $state(false);
	let score: number | null = $state(null);
	let lastCorrect: boolean | null = $state(null);
	let correctTimer: ReturnType<typeof setTimeout> | null = null;
	let flushing = false;

	const total = $derived(config?.questions.length ?? 0);
	const remaining = $derived(progress ? remainingOf(progress) : []);
	const answeredCount = $derived(progress?.answers.length ?? 0);
	const unconfirmedCount = $derived(progress?.answers.filter((a) => !a.confirmed).length ?? 0);
	const currentQ = $derived(remaining[0]);
	const showsLeaderboard = $derived(config !== null && config.leaderboard.visibility !== 'none');

	onMount(() => {
		void init();
	});

	onDestroy(() => {
		if (toastTimer) clearTimeout(toastTimer);
		if (correctTimer) clearTimeout(correctTimer);
	});

	async function init() {
		phase = 'loading';
		errorMsg = '';
		try {
			config = await getQuizConfig(slug);
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Could not load the quiz.';
			phase = 'error';
			return;
		}
		let saved = loadProgress(slug);
		if (saved && saved.generation !== config.generation) {
			// the quiz was reset since this device played: start over
			clearProgress(slug);
			saved = null;
		}
		if (!saved) {
			if (config.nameMode === 'required') {
				if (config.namePrefill) nameInput = localStorage.getItem(NAME_KEY) ?? randomName();
				phase = 'naming';
			} else {
				start('');
			}
			return;
		}
		let p = reconcileProgress(saved, config.questions.length, config.randomizeOrder);
		try {
			const server = await getSession(slug, p.sessionId);
			p = mergeServerAnswers(p, server.answered);
			if (server.score !== undefined) score = server.score;
		} catch {
			// offline: local state stands, the outbox will reconcile
		}
		progress = p;
		saveProgress(slug, p);
		void flushOutbox();
		if (p.answers.length >= config.questions.length) {
			p.done = true;
			saveProgress(slug, p);
			phase = 'done';
			void refreshEndState();
		} else {
			phase = 'resume';
			if (config.leaderboard.visibility === 'always') void refreshLeaderboard();
		}
	}

	function start(name: string) {
		if (!config) return;
		progress = newProgress(config.questions.length, config.randomizeOrder, name, config.generation);
		saveProgress(slug, progress);
		phase = 'surveying';
	}

	function continueFromNaming() {
		const trimmed = nameInput.trim();
		if (!trimmed) return;
		localStorage.setItem(NAME_KEY, trimmed);
		start(trimmed);
	}

	function handleSwipe(dir: SwipeDirection) {
		if (!progress || !config) return;
		// capture before the push: the push updates `remaining`, and with it `currentQ`
		const q = currentQ;
		if (q === undefined) return;
		progress.answers.push({ qIndex: q, answer: dir, confirmed: false });
		saveProgress(slug, progress);
		void submit(q, dir);
		if (progress.answers.length >= config.questions.length) {
			setTimeout(() => {
				if (!progress) return;
				progress.done = true;
				saveProgress(slug, progress);
				phase = 'done';
				void refreshEndState();
			}, 400);
		}
	}

	async function submit(qIndex: number, answer: SwipeDirection) {
		if (!progress) return;
		try {
			const ack = await postAnswer(slug, {
				sessionId: progress.sessionId,
				qIndex,
				answer,
				name: progress.name,
				timestamp: Date.now(),
				generation: progress.generation
			});
			markConfirmed(qIndex);
			if (ack.correct !== undefined) flashCorrect(ack.correct);
			showToast({ status: 'ok' });
		} catch {
			showToast({ status: 'failed', retry: retryFailed });
		}
	}

	function retryFailed() {
		toast = null;
		void flushOutbox().then(() => {
			if (progress?.answers.some((a) => !a.confirmed)) {
				showToast({ status: 'failed', retry: retryFailed });
			} else {
				showToast({ status: 'ok' });
			}
		});
	}

	function markConfirmed(qIndex: number) {
		if (!progress) return;
		const a = progress.answers.find((x) => x.qIndex === qIndex);
		if (a) {
			a.confirmed = true;
			saveProgress(slug, progress);
		}
	}

	async function flushOutbox() {
		if (flushing || !progress) return;
		flushing = true;
		try {
			for (const a of progress.answers.filter((x) => !x.confirmed)) {
				await postAnswer(slug, {
					sessionId: progress.sessionId,
					qIndex: a.qIndex,
					answer: a.answer,
					name: progress.name,
					timestamp: Date.now(),
					generation: progress.generation
				});
				markConfirmed(a.qIndex);
			}
		} catch {
			// a later retry or reload resumes from the first unconfirmed answer
		} finally {
			flushing = false;
		}
	}

	async function refreshLeaderboard() {
		try {
			leaderboard = (await getLeaderboard(slug)).entries;
		} catch {
			leaderboard = null;
		}
	}

	function openBoard() {
		showBoard = true;
		void refreshLeaderboard();
	}

	async function refreshEndState() {
		await flushOutbox();
		if (showsLeaderboard) await refreshLeaderboard();
		if (progress && config && (config.feedback === 'final' || config.feedback === 'both')) {
			try {
				score = (await getSession(slug, progress.sessionId)).score ?? null;
			} catch {
				// keep whatever score we had
			}
		}
	}

	function retryUnconfirmed() {
		void flushOutbox().then(() => {
			if (showsLeaderboard) void refreshLeaderboard();
		});
	}

	function showToast(t: { status: 'ok' | 'failed'; retry?: () => void }) {
		if (toastTimer) clearTimeout(toastTimer);
		toast = t;
		if (t.status === 'ok') {
			toastTimer = setTimeout(() => {
				toast = null;
			}, 2000);
		}
	}

	function flashCorrect(ok: boolean) {
		if (correctTimer) clearTimeout(correctTimer);
		lastCorrect = ok;
		correctTimer = setTimeout(() => {
			lastCorrect = null;
		}, 1200);
	}
</script>

<svelte:head>
	<title>{config?.name || 'Quiz'}</title>
</svelte:head>

<div class="page">
	{#if showBoard}
		<div class="center">
			<div class="box">
				{#if config?.name}<p class="quiz-title-sm">{config.name}</p>{/if}
				{#if leaderboard}
					<Leaderboard entries={leaderboard} />
				{:else}
					<p class="muted">Loading…</p>
				{/if}
				<button class="primary wide" onclick={() => (showBoard = false)}>
					{phase === 'surveying' ? 'Back to the quiz' : 'Back'}
				</button>
			</div>
		</div>
	{:else if phase === 'loading'}
		<div class="center"><span class="muted">Loading quiz…</span></div>
	{:else if phase === 'error'}
		<div class="center">
			<div class="box">
				<p>{errorMsg}</p>
				<button class="primary" onclick={() => void init()}>Retry</button>
			</div>
		</div>
	{:else if phase === 'naming'}
		<div class="center">
			<div class="box">
				{#if config?.name}<p class="quiz-title-sm">{config.name}</p>{/if}
				<h2>{config?.namePrompt}</h2>
				<input
					class="naming-input"
					type="text"
					bind:value={nameInput}
					placeholder="Your name"
					onkeydown={(e) => e.key === 'Enter' && continueFromNaming()}
				/>
				<button class="primary wide" onclick={continueFromNaming} disabled={!nameInput.trim()}>
					Start
				</button>
			</div>
		</div>
	{:else if phase === 'resume' && progress}
		<div class="center">
			<div class="box">
				{#if config?.name}<p class="quiz-title-sm">{config.name}</p>{/if}
				<h2>Welcome back{progress.name ? `, ${progress.name}` : ''}</h2>
				<p class="muted">{answeredCount} of {total} answered</p>
				<button class="primary wide" onclick={() => (phase = 'surveying')}>Continue</button>
			</div>
		</div>
	{:else if phase === 'done'}
		<div class="center">
			<div class="box">
				<div class="done-icon">✓</div>
				<h2>All done!</h2>
				{#if progress?.name}
					<p class="muted">Your answers have been recorded as <strong>{progress.name}</strong>.</p>
				{/if}
				{#if unconfirmedCount > 0}
					<div class="unconfirmed">
						⚠ {unconfirmedCount}
						{unconfirmedCount === 1 ? 'answer is' : 'answers are'} not confirmed yet
						<button class="retry-sm" onclick={retryUnconfirmed}>Retry</button>
					</div>
				{/if}
				{#if score !== null}
					<p class="score">Your score: <strong>{score}</strong> / {total}</p>
				{/if}
				{#if showsLeaderboard && leaderboard}
					<Leaderboard entries={leaderboard} />
				{/if}
			</div>
		</div>
	{:else if phase === 'surveying' && config && progress && currentQ !== undefined}
		<div class="survey">
			{#if config.name}
				<div class="quiz-title">{config.name}</div>
			{/if}
			{#if progress.name}
				<div class="name-bar"><span class="name-text">{progress.name}</span></div>
			{/if}

			{#if lastCorrect !== null}
				<div class="correct-flash" class:yes={lastCorrect} class:no={!lastCorrect}>
					{lastCorrect ? '✓ Correct' : '✗ Wrong'}
				</div>
			{/if}

			<SwipeDeck
				labels={config.labels}
				question={config.questions[currentQ]}
				index={answeredCount}
				{total}
				onSwipe={handleSwipe}
			/>
		</div>
	{/if}

	{#if config?.leaderboard.visibility === 'always' && !showBoard && (phase === 'naming' || phase === 'resume' || phase === 'surveying')}
		<button class="board-btn" onclick={openBoard} aria-label="Leaderboard">🏆</button>
	{/if}

	{#if toast}
		<StatusToast status={toast.status} retry={toast.retry} onDismiss={() => (toast = null)} />
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

	.box {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		text-align: center;
		max-width: 420px;
		width: 100%;
		padding: 2rem;
	}

	.box h2 {
		margin: 0;
		font-size: 1.5rem;
	}

	.box .muted {
		margin: 0;
	}

	.quiz-title-sm {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-muted);
		margin: 0;
	}

	.naming-input {
		width: 100%;
		font-size: 1rem;
		padding: 0.6rem 0.75rem;
		border-radius: 8px;
		text-align: center;
	}

	.wide {
		width: 100%;
		font-size: 1rem;
		padding: 0.65rem 1.5rem;
	}

	.done-icon {
		font-size: 3rem;
		color: var(--success);
	}

	.unconfirmed {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--warning);
		background: color-mix(in srgb, var(--warning) 12%, var(--surface));
		border: 1px solid color-mix(in srgb, var(--warning) 40%, var(--border));
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
	}

	.retry-sm {
		background: none;
		border: 1px solid currentColor;
		color: inherit;
		font-size: 0.75rem;
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		cursor: pointer;
	}

	.score {
		margin: 0;
		font-size: 1rem;
	}

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

	.quiz-title {
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

	.name-bar {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
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

	.correct-flash {
		position: absolute;
		top: 3rem;
		left: 50%;
		transform: translateX(-50%);
		font-size: 1rem;
		font-weight: 700;
		z-index: 20;
		padding: 0.3rem 0.9rem;
		border-radius: 20px;
	}

	.correct-flash.yes {
		color: var(--success);
		background: color-mix(in srgb, var(--success) 15%, var(--surface));
		border: 1px solid color-mix(in srgb, var(--success) 40%, var(--border));
	}

	.correct-flash.no {
		color: var(--danger);
		background: color-mix(in srgb, var(--danger) 15%, var(--surface));
		border: 1px solid color-mix(in srgb, var(--danger) 40%, var(--border));
	}

	.board-btn {
		position: fixed;
		bottom: 1rem;
		right: 1rem;
		width: 2.75rem;
		height: 2.75rem;
		padding: 0;
		border-radius: 50%;
		font-size: 1.25rem;
		line-height: 1;
		background: var(--surface2);
		border: 1px solid var(--border);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
		z-index: 50;
	}

	.board-btn:hover {
		background: var(--surface);
	}
</style>
