<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { NostrPool } from '$lib/nostr';
	import { encryptConfig, decryptConfig } from '$lib/crypto';
	import { getAdmin, saveAnswer, getAnswersForForm } from '$lib/store';
	import { getRelays, setRelays, resetRelays } from '$lib/relays';
	import { DEFAULT_CONFIG, type FormConfig, type AdminRecord, type AnswerRecord } from '$lib/types';

	type Phase = 'loading' | 'ready' | 'not-found';
	type SwipeLabelKey = 'swipeLeftLabel' | 'swipeRightLabel' | 'swipeUpLabel' | 'swipeDownLabel';

	let phase: Phase = $state('loading');
	let record: AdminRecord | null = $state(null);
	let config: FormConfig = $state({ ...DEFAULT_CONFIG });
	let answers: AnswerRecord[] = $state([]);
	let copied = $state(false);
	let publishStatus = $state('');
	let batchOpen = $state(false);
	let batchText = $state('');
	let batchError = $state('');
	let relayStatus: { url: string; ok: boolean }[] = $state([]);
	let relayEditing = $state(false);
	let relayText = $state('');
	let showCredentials = $state(false);
	let credCopied = $state('');

	let pool: NostrPool | null = null;
	let unsubAnswers: (() => void) | null = null;
	let publishTimer: ReturnType<typeof setTimeout> | null = null;
	let aggPublishTimer: ReturnType<typeof setTimeout> | null = null;

	const MAX_QUESTIONS = 1000;

	const connectedCount = $derived(relayStatus.filter((r) => r.ok).length);
	const aggregate = $derived(computeAggregate());

	function fillUrl(): string {
		if (!record) return '';
		return `${window.location.origin}/fill#${record.pubkey}_${record.configAesKey}`;
	}

	async function copyText(text: string, key: string) {
		await navigator.clipboard.writeText(text);
		credCopied = key;
		setTimeout(() => (credCopied = ''), 2000);
	}

	async function copyLink() {
		await navigator.clipboard.writeText(fillUrl());
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	async function copyExportJson() {
		if (!record) return;
		const json = JSON.stringify(
			{ pubkey: record.pubkey, privkeyHex: record.privkeyHex, configAesKey: record.configAesKey },
			null,
			2
		);
		await navigator.clipboard.writeText(json);
		credCopied = 'json';
		setTimeout(() => (credCopied = ''), 2000);
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

	function computeAggregate(): { question: string; score: number; votes: number }[] | null {
		const vals: Record<string, number> = {};
		const dirs: [string, string][] = [
			['Left', config.swipeLeftLabel],
			['Right', config.swipeRightLabel],
			['Up', config.swipeUpLabel],
			['Down', config.swipeDownLabel]
		];
		for (const [dir, label] of dirs) {
			if (label === '') continue;
			const n = Number(label);
			if (!isNaN(n)) vals[dir] = n;
		}
		if (Object.keys(vals).length === 0) return null;
		return config.questions.map((q, i) => {
			const relevant = answers.filter((a) => a.qIndex === i && a.answer in vals);
			const score = relevant.reduce((s, a) => s + (vals[a.answer] ?? 0), 0);
			return { question: q, score, votes: relevant.length };
		});
	}

	async function doPublishAggregate() {
		if (!pool || !record || config.aggregateVisibility === 'admin-only') return;
		const agg = computeAggregate();
		if (!agg) return;
		try {
			const json = JSON.stringify({ updatedAt: Date.now(), questions: agg });
			const encrypted = await encryptConfig(json, record.configAesKey);
			await pool.publishAggregate(record.privkeyHex, record.pubkey, encrypted);
		} catch {
			// best-effort
		}
	}

	function scheduleAggregatePublish() {
		if (config.aggregateVisibility === 'admin-only' || !pool || !record) return;
		if (aggPublishTimer) clearTimeout(aggPublishTimer);
		aggPublishTimer = setTimeout(doPublishAggregate, 2000);
	}

	function updateLabel(key: SwipeLabelKey, value: string) {
		config = { ...config, [key]: value };
		schedulePublish();
		scheduleAggregatePublish();
	}

	function updateAggregateVisibility(onCompletion: boolean) {
		config = { ...config, aggregateVisibility: onCompletion ? 'on-completion' : 'admin-only' };
		schedulePublish();
		scheduleAggregatePublish();
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

	async function saveRelays() {
		const urls = relayText
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		if (urls.length === 0) return;
		setRelays(urls);
		relayEditing = false;
		if (pool) {
			await pool.connect();
			relayStatus = [...pool.relayStatus];
		}
	}

	async function resetRelayList() {
		resetRelays();
		if (pool) {
			await pool.connect();
			relayStatus = [...pool.relayStatus];
		}
		relayEditing = false;
	}

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
		relayStatus = [...pool.relayStatus];

		const unsubConfig = pool.subscribeConfig(pubkey, async (encryptedContent) => {
			try {
				const json = await decryptConfig(encryptedContent, admin.configAesKey);
				config = { ...DEFAULT_CONFIG, ...JSON.parse(json) };
			} catch {
				// ignore malformed
			}
			unsubConfig();
		});

		unsubAnswers = pool.subscribeAnswers(pubkey, admin.privkeyHex, async (payload, eventId) => {
			try {
				const answer: Omit<AnswerRecord, 'eventId' | 'formPubkey'> = JSON.parse(payload);
				const rec: AnswerRecord = { ...answer, eventId, formPubkey: pubkey };
				await saveAnswer(rec);
				answers = await getAnswersForForm(pubkey);
				scheduleAggregatePublish();
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
		if (aggPublishTimer) clearTimeout(aggPublishTimer);
	});

	const SWIPE_LABELS: { key: SwipeLabelKey; dir: string }[] = [
		{ key: 'swipeLeftLabel', dir: '← Left' },
		{ key: 'swipeRightLabel', dir: 'Right →' },
		{ key: 'swipeUpLabel', dir: '↑ Up' },
		{ key: 'swipeDownLabel', dir: '↓ Down (empty = disabled)' }
	];

	function numericLabelsSummary(): string {
		return [
			config.swipeLeftLabel && !isNaN(Number(config.swipeLeftLabel))
				? `← ${config.swipeLeftLabel}`
				: '',
			config.swipeRightLabel && !isNaN(Number(config.swipeRightLabel))
				? `→ ${config.swipeRightLabel}`
				: '',
			config.swipeUpLabel && !isNaN(Number(config.swipeUpLabel))
				? `↑ ${config.swipeUpLabel}`
				: '',
			config.swipeDownLabel && !isNaN(Number(config.swipeDownLabel))
				? `↓ ${config.swipeDownLabel}`
				: ''
		]
			.filter(Boolean)
			.join(', ');
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
			<div
				class="relay-indicator"
				title="{connectedCount}/{relayStatus.length} relays connected"
			>
				<span class="dot" class:ok={connectedCount >= 3}></span>
				{connectedCount}/{relayStatus.length} relays
			</div>
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

			<!-- Multi-device access -->
			<section class="card">
				<h2>Admin access on other devices</h2>
				<p class="hint">
					Your private key lives only in this browser. Open the same admin URL on another device by
					exporting these credentials and importing them on the other machine via the Swack home
					page.
				</p>
				<button class="ghost" onclick={() => (showCredentials = !showCredentials)}>
					{showCredentials ? 'Hide credentials' : 'Export credentials'}
				</button>
				{#if showCredentials}
					<div class="cred-box">
						<p class="cred-warn">
							Anyone with the private key can publish config changes and decrypt all answers. Store
							securely.
						</p>
						{#each [
							{ label: 'Public key (form ID)', key: 'pubkey', value: record.pubkey },
							{ label: 'Private key', key: 'privkey', value: record.privkeyHex },
							{ label: 'Config AES key', key: 'aeskey', value: record.configAesKey }
						] as cred}
							<div class="cred-item">
								<span class="cred-label">{cred.label}</span>
								<div class="cred-value-row">
									<code class="cred-value">{cred.value}</code>
									<button class="ghost small" onclick={() => copyText(cred.value, cred.key)}>
										{credCopied === cred.key ? '✓' : 'Copy'}
									</button>
								</div>
							</div>
						{/each}
						<button class="primary" onclick={copyExportJson}>
							{credCopied === 'json' ? 'Copied!' : 'Copy all as JSON'}
						</button>
						<p class="hint">
							On the other device: go to the Swack home page → "Import existing form" → paste the
							JSON.
						</p>
					</div>
				{/if}
			</section>

			<!-- Swipe labels -->
			<section class="card">
				<h2>Swipe labels</h2>
				<div class="labels-grid">
					{#each SWIPE_LABELS as { key, dir }}
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
				<div class="aggregate-opt">
					<label class="inline-label">
						<input
							type="checkbox"
							checked={config.aggregateVisibility === 'on-completion'}
							onchange={(e) =>
								updateAggregateVisibility((e.target as HTMLInputElement).checked)}
						/>
						Show numeric aggregate to respondents after completion
					</label>
					<p class="hint">
						When label values are numbers, respondents see a score summary on their done screen.
					</p>
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
						<button class="primary" onclick={applyBatch}>
							Add {batchText.split('\n').filter((s) => s.trim()).length} questions
						</button>
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
							<button class="danger-btn" onclick={() => removeQuestion(i)} aria-label="Remove"
								>✕</button
							>
						</li>
					{/each}
				</ol>

				{#if config.questions.length === 0}
					<p class="empty-hint">No questions yet. Add one above or use batch import.</p>
				{/if}
			</section>

			<!-- Aggregate scores -->
			{#if aggregate}
				<section class="card">
					<h2>Aggregate scores</h2>
					<p class="hint">Numeric directions: {numericLabelsSummary()}</p>
					<table>
						<thead>
							<tr>
								<th>#</th>
								<th>Question</th>
								<th>Score</th>
								<th>Votes</th>
							</tr>
						</thead>
						<tbody>
							{#each aggregate as row, i}
								<tr>
									<td class="mono">{i + 1}</td>
									<td>{row.question}</td>
									<td class:positive={row.score > 0} class:negative={row.score < 0}>
										{row.score > 0 ? '+' : ''}{row.score}
									</td>
									<td class="muted">{row.votes}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</section>
			{/if}

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
								<span class="sess-count muted"
									>{sess.answers} answer{sess.answers !== 1 ? 's' : ''}</span
								>
							</div>
						{/each}
					</div>
					<details class="raw-answers">
						<summary>Raw answers</summary>
						<table>
							<thead>
								<tr>
									<th>Session</th>
									<th>Name</th>
									<th>Q#</th>
									<th>Answer</th>
								</tr>
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

			<!-- Relay management -->
			<section class="card">
				<div class="section-header">
					<h2>Relay connections ({connectedCount}/{relayStatus.length})</h2>
					<button
						class="ghost"
						onclick={() => {
							if (!relayEditing) relayText = getRelays().join('\n');
							relayEditing = !relayEditing;
						}}
					>
						{relayEditing ? 'Cancel' : 'Manage'}
					</button>
				</div>
				{#if !relayEditing}
					<div class="relay-list">
						{#each relayStatus as r}
							<div class="relay-row">
								<span class="dot sm" class:ok={r.ok}></span>
								<span class="relay-url">{r.url}</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="hint">
						One relay URL per line. Saved locally and applies to all forms on this device.
					</p>
					<textarea
						bind:value={relayText}
						rows={8}
						placeholder="wss://relay.example.com"
					></textarea>
					<div class="relay-actions">
						<button class="primary" onclick={saveRelays}>Save & reconnect</button>
						<button class="ghost" onclick={resetRelayList}>Reset to defaults</button>
					</div>
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

	.relay-indicator {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8125rem;
		color: var(--text-muted);
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--danger);
		flex-shrink: 0;
	}

	.dot.ok {
		background: var(--success);
	}

	.dot.sm {
		width: 7px;
		height: 7px;
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

	.cred-box {
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1rem;
	}

	.cred-warn {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--warning);
	}

	.cred-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.cred-label {
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.cred-value-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.cred-value {
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
		word-break: break-all;
		flex: 1;
		color: var(--text-muted);
	}

	button.small {
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		flex-shrink: 0;
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

	.aggregate-opt {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}

	.inline-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-direction: row;
		font-size: 0.875rem;
		cursor: pointer;
	}

	.inline-label input[type='checkbox'] {
		width: auto;
		margin: 0;
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

	.positive {
		color: var(--success);
		font-weight: 600;
	}

	.negative {
		color: var(--danger);
		font-weight: 600;
	}

	.relay-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.relay-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.relay-url {
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.relay-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	@media (max-width: 480px) {
		.labels-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
