<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { NostrPool } from '$lib/nostr';
	import { encryptConfig, decryptConfig } from '$lib/crypto';
	import { getAdmin, saveAnswer, getAnswersForForm } from '$lib/store';
	import { DEFAULT_CONFIG, type FormConfig, type AdminRecord, type AnswerRecord } from '$lib/types';

	type Phase = 'loading' | 'ready' | 'not-found';

	let phase: Phase = $state('loading');
	let record: AdminRecord | null = $state(null);
	let config: FormConfig = $state({ ...DEFAULT_CONFIG });
	let answers: AnswerRecord[] = $state([]);
	let copied = $state(false);
	let publishStatus = $state('');
	let batchOpen = $state(false);
	let batchText = $state('');
	let batchError = $state('');

	let pool: NostrPool | null = null;
	let unsubAnswers: (() => void) | null = null;
	let publishTimer: ReturnType<typeof setTimeout> | null = null;

	const MAX_QUESTIONS = 1000;

	function fillUrl(): string {
		if (!record) return '';
		return `${window.location.origin}/fill#${record.pubkey}_${record.configAesKey}`;
	}

	async function copyLink() {
		await navigator.clipboard.writeText(fillUrl());
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	async function publishConfig() {
		if (!pool || !record) return;
		try {
			const json = JSON.stringify(config);
			const encrypted = await encryptConfig(json, record.configAesKey);
			await pool.publishConfig(record.privkeyHex, record.pubkey, encrypted);
			publishStatus = 'Saved';
			setTimeout(() => (publishStatus = ''), 2000);
		} catch {
			publishStatus = 'Publish failed';
		}
	}

	function schedulePublish() {
		if (publishTimer) clearTimeout(publishTimer);
		publishTimer = setTimeout(publishConfig, 800);
	}

	function addQuestion() {
		if (config.questions.length >= MAX_QUESTIONS) return;
		config.questions = [...config.questions, ''];
		schedulePublish();
	}

	function removeQuestion(i: number) {
		config.questions = config.questions.filter((_, idx) => idx !== i);
		schedulePublish();
	}

	function updateQuestion(i: number, value: string) {
		config.questions = config.questions.map((q, idx) => (idx === i ? value : q));
		schedulePublish();
	}

	function updateLabel(key: keyof Omit<FormConfig, 'questions'>, value: string) {
		config = { ...config, [key]: value };
		schedulePublish();
	}

	function applyBatch() {
		batchError = '';
		const lines = batchText
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		if (lines.length === 0) {
			batchError = 'No questions found.';
			return;
		}
		const combined = [...config.questions, ...lines];
		if (combined.length > MAX_QUESTIONS) {
			batchError = `That would exceed ${MAX_QUESTIONS} questions (currently ${config.questions.length}, adding ${lines.length}).`;
			return;
		}
		config.questions = combined;
		batchText = '';
		batchOpen = false;
		schedulePublish();
	}

	onMount(async () => {
		const pubkey = window.location.hash.slice(1);
		if (!pubkey) {
			phase = 'not-found';
			return;
		}

		const admin = await getAdmin(pubkey);
		if (!admin) {
			phase = 'not-found';
			return;
		}

		record = admin;
		answers = await getAnswersForForm(pubkey);

		pool = new NostrPool();
		await pool.connect();

		// load existing config from relay
		const unsubConfig = pool.subscribeConfig(pubkey, async (encryptedContent) => {
			try {
				const json = await decryptConfig(encryptedContent, admin.configAesKey);
				config = JSON.parse(json);
			} catch {
				// ignore malformed
			}
			unsubConfig();
		});

		// subscribe to incoming answers
		unsubAnswers = pool.subscribeAnswers(pubkey, admin.privkeyHex, async (payload, eventId) => {
			try {
				const answer: Omit<AnswerRecord, 'eventId' | 'formPubkey'> = JSON.parse(payload);
				const record: AnswerRecord = { ...answer, eventId, formPubkey: pubkey };
				await saveAnswer(record);
				answers = await getAnswersForForm(pubkey);
			} catch {
				// malformed payload
			}
		});

		phase = 'ready';
	});

	onDestroy(() => {
		unsubAnswers?.();
		pool?.destroy();
		if (publishTimer) clearTimeout(publishTimer);
	});

	const LABELS: { key: keyof Omit<FormConfig, 'questions'>; dir: string }[] = [
		{ key: 'swipeLeftLabel', dir: '← Left' },
		{ key: 'swipeRightLabel', dir: 'Right →' },
		{ key: 'swipeUpLabel', dir: '↑ Up' },
		{ key: 'swipeDownLabel', dir: '↓ Down' }
	];

	function sessionSummary(): { id: string; name: string; answers: number }[] {
		const map = new Map<string, { name: string; count: number }>();
		for (const a of answers) {
			const entry = map.get(a.sessionId);
			if (entry) entry.count++;
			else map.set(a.sessionId, { name: a.name, count: 1 });
		}
		return Array.from(map.entries()).map(([id, { name, count }]) => ({
			id,
			name,
			answers: count
		}));
	}
</script>

<svelte:head>
	<title>Admin — Swack</title>
</svelte:head>

{#if phase === 'loading'}
	<div class="center"><span class="muted">Loading…</span></div>
{:else if phase === 'not-found'}
	<div class="center">
		<p class="muted">Form not found in this browser. <a href="/">Go home</a></p>
	</div>
{:else if phase === 'ready' && record}
	<div class="page">
		<header>
			<a href="/" class="logo">Swack</a>
			<span class="muted">Admin</span>
		</header>

		<main>
			<!-- Share link -->
			<section class="card">
				<h2>Share link</h2>
				<div class="link-row">
					<span class="link-text">{fillUrl()}</span>
					<button class="primary" onclick={copyLink}>{copied ? 'Copied!' : 'Copy'}</button>
				</div>
				<p class="hint">Anyone with this link can fill out the survey.</p>
			</section>

			<!-- Labels -->
			<section class="card">
				<h2>Swipe labels</h2>
				<div class="labels-grid">
					{#each LABELS as { key, dir }}
						<label>
							<span class="dir">{dir}</span>
							<input
								type="text"
								value={config[key]}
								oninput={(e) => updateLabel(key, (e.target as HTMLInputElement).value)}
							/>
						</label>
					{/each}
				</div>
			</section>

			<!-- Questions -->
			<section class="card">
				<div class="section-header">
					<h2>Questions ({config.questions.length}/{MAX_QUESTIONS})</h2>
					<div class="actions">
						{#if publishStatus}
							<span class="status">{publishStatus}</span>
						{/if}
						<button class="ghost" onclick={() => (batchOpen = !batchOpen)}>
							{batchOpen ? 'Close batch' : 'Batch import'}
						</button>
						<button
							class="primary"
							onclick={addQuestion}
							disabled={config.questions.length >= MAX_QUESTIONS}
						>
							+ Add
						</button>
					</div>
				</div>

				{#if batchOpen}
					<div class="batch-area">
						<textarea
							bind:value={batchText}
							rows={6}
							placeholder="One question per line (up to {MAX_QUESTIONS} total)…"
						></textarea>
						{#if batchError}
							<p class="error">{batchError}</p>
						{/if}
						<button class="primary" onclick={applyBatch}>Add {batchText.split('\n').filter(s => s.trim()).length} questions</button>
					</div>
				{/if}

				<ol class="question-list">
					{#each config.questions as q, i}
						<li class="question-item">
							<span class="q-num">{i + 1}</span>
							<input
								type="text"
								value={q}
								oninput={(e) => updateQuestion(i, (e.target as HTMLInputElement).value)}
								placeholder="Question text…"
							/>
							<button class="danger-btn" onclick={() => removeQuestion(i)} aria-label="Remove">✕</button>
						</li>
					{/each}
				</ol>

				{#if config.questions.length === 0}
					<p class="empty-hint">No questions yet. Add one above or use batch import.</p>
				{/if}
			</section>

			<!-- Responses -->
			<section class="card">
				<h2>Responses ({answers.length})</h2>
				{#if answers.length === 0}
					<p class="muted">No responses yet.</p>
				{:else}
					<div class="sessions">
						{#each sessionSummary() as sess}
							<div class="session-row">
								<span class="sess-name">{sess.name}</span>
								<span class="sess-count muted">{sess.answers} answer{sess.answers !== 1 ? 's' : ''}</span>
							</div>
						{/each}
					</div>
					<details class="raw-answers">
						<summary>Raw answers</summary>
						<table>
							<thead>
								<tr><th>Session</th><th>Name</th><th>Q#</th><th>Answer</th></tr>
							</thead>
							<tbody>
								{#each answers as a}
									<tr>
										<td class="mono">{a.sessionId.slice(0, 8)}</td>
										<td>{a.name}</td>
										<td>{a.qIndex + 1}</td>
										<td>{a.answer}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</details>
				{/if}
			</section>
		</main>
	</div>
{/if}

<style>
	.page {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}

	.center {
		display: flex;
		align-items: center;
		justify-content: center;
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

	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 1.5rem;
	}

	h2 {
		font-size: 0.8125rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		margin: 0 0 1rem;
	}

	.link-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
		flex-wrap: wrap;
	}

	.link-text {
		flex: 1;
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
		word-break: break-all;
		color: var(--text-muted);
	}

	.hint {
		margin: 0.5rem 0 0;
		font-size: 0.8125rem;
		color: var(--text-muted);
	}

	.labels-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.dir {
		font-size: 0.8125rem;
		color: var(--text-muted);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.section-header h2 {
		margin: 0;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.status {
		font-size: 0.8125rem;
		color: var(--success);
	}

	.batch-area {
		margin-bottom: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.error {
		font-size: 0.8125rem;
		color: var(--danger);
		margin: 0;
	}

	.question-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.question-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.q-num {
		font-size: 0.75rem;
		color: var(--text-muted);
		min-width: 1.5rem;
		text-align: right;
	}

	.empty-hint {
		font-size: 0.875rem;
		color: var(--text-muted);
		margin: 0.5rem 0 0;
	}

	.sessions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.session-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: var(--surface2);
		border-radius: 6px;
	}

	.sess-name {
		font-size: 0.9rem;
		font-weight: 500;
	}

	.sess-count {
		font-size: 0.8125rem;
	}

	.muted {
		color: var(--text-muted);
	}

	.raw-answers summary {
		cursor: pointer;
		font-size: 0.8125rem;
		color: var(--text-muted);
		margin-bottom: 0.75rem;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	th {
		text-align: left;
		color: var(--text-muted);
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--border);
		font-weight: 500;
	}

	td {
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--border);
	}

	.mono {
		font-family: ui-monospace, monospace;
	}

	@media (max-width: 480px) {
		.labels-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
