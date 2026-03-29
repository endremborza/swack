<script lang="ts">
	import { base } from '$app/paths';
	import PageLayout from '$lib/components/PageLayout.svelte';
	import { NostrPool, generateKeypair, MIN_CONFIRMED } from '$lib/nostr';
	import { encryptConfig } from '$lib/crypto';
	import { saveAdmin } from '$lib/store';
	import { generateAesKey } from '$lib/crypto';
	import { getRelays, setRelays } from '$lib/relays';
	import { DEFAULT_CONFIG, type FormConfig } from '$lib/types';

	type CreatePhase = 'building' | 'publishing' | 'done' | 'failed';
	type SwipeLabelKey = 'swipeLeftLabel' | 'swipeRightLabel' | 'swipeUpLabel' | 'swipeDownLabel';

	let phase: CreatePhase = $state('building');
	let config: FormConfig = $state({ ...DEFAULT_CONFIG });
	let batchOpen = $state(false);
	let batchText = $state('');
	let batchError = $state('');
	let advancedOpen = $state(false);
	let relayText = $state(getRelays().join('\n'));

	// publish state
	let relayConfirms: { url: string; status: 'pending' | 'ok' | 'fail' }[] = $state([]);
	let acceptedCount = $state(0);
	let shareLink = $state('');
	let publishedPubkey = $state('');
	let publishError = $state('');

	const MAX_QUESTIONS = 1000;

	const SWIPE_LABELS: { key: SwipeLabelKey; dir: string }[] = [
		{ key: 'swipeLeftLabel', dir: '← Left' },
		{ key: 'swipeRightLabel', dir: 'Right →' },
		{ key: 'swipeUpLabel', dir: '↑ Up' },
		{ key: 'swipeDownLabel', dir: '↓ Down (empty = disabled)' }
	];

	function updateLabel(key: SwipeLabelKey, value: string) {
		config = { ...config, [key]: value };
	}

	function addQuestion() {
		if (config.questions.length >= MAX_QUESTIONS) return;
		config.questions = [...config.questions, ''];
	}

	function removeQuestion(i: number) {
		config.questions = config.questions.filter((_, idx) => idx !== i);
	}

	function updateQuestion(i: number, value: string) {
		config.questions = config.questions.map((q, idx) => (idx === i ? value : q));
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
			batchError = `That would exceed ${MAX_QUESTIONS} questions.`;
			return;
		}
		config.questions = combined;
		batchText = '';
		batchOpen = false;
	}

	async function publish() {
		if (config.questions.length === 0) return;
		phase = 'publishing';
		publishError = '';

		const { privkeyHex, pubkey } = generateKeypair();
		const configAesKey = generateAesKey();

		const pool = new NostrPool();
		relayConfirms = getRelays().map((url) => ({ url, status: 'pending' as const }));
		await pool.connect(true);

		relayConfirms = pool.relayStatus.map((r) => ({
			url: r.url,
			status: r.ok ? ('pending' as const) : ('fail' as const)
		}));

		let encryptedContent: string;
		try {
			encryptedContent = await encryptConfig(JSON.stringify(config), configAesKey);
		} catch {
			phase = 'failed';
			publishError = 'Failed to encrypt form config.';
			pool.destroy();
			return;
		}

		const result = await pool.publishConfig(privkeyHex, pubkey, encryptedContent, (url, ok) => {
			relayConfirms = relayConfirms.map((r) =>
				r.url === url ? { ...r, status: ok ? 'ok' : 'fail' } : r
			);
			if (ok) acceptedCount++;
		});

		pool.destroy();

		if (result.accepted === 0) {
			phase = 'failed';
			publishError = 'No relays accepted the form. Check your connection and try again.';
			return;
		}

		await saveAdmin({ pubkey, privkeyHex, configAesKey, name: config.name || undefined });

		publishedPubkey = pubkey;
		shareLink = `${window.location.origin}${base}/fill#${pubkey}_${configAesKey}`;
		phase = 'done';
	}

	function retryPublish() {
		phase = 'building';
		relayConfirms = [];
		acceptedCount = 0;
	}

	function applyRelays() {
		const urls = relayText
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		if (urls.length > 0) setRelays(urls);
	}
</script>

<svelte:head>
	<title>Create a form — Swack</title>
</svelte:head>

<PageLayout subtitle="New form">
	{#if phase === 'building' || phase === 'publishing'}
		<!-- Form name -->
		<section class="card">
			<h2>Form name</h2>
			<input
				type="text"
				value={config.name}
				oninput={(e) => (config = { ...config, name: (e.target as HTMLInputElement).value })}
				placeholder="Untitled form"
				disabled={phase === 'publishing'}
			/>
			<p class="hint">Shown to respondents.</p>
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
							disabled={phase === 'publishing'}
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
							(config = {
								...config,
								aggregateVisibility: (e.target as HTMLInputElement).checked
									? 'on-completion'
									: 'admin-only'
							})}
						disabled={phase === 'publishing'}
					/>
					Show numeric aggregate to respondents after completion
				</label>
			</div>
			<div class="aggregate-opt">
				<label class="inline-label">
					<input
						type="checkbox"
						checked={config.randomizeOrder}
						onchange={(e) =>
							(config = { ...config, randomizeOrder: (e.target as HTMLInputElement).checked })}
						disabled={phase === 'publishing'}
					/>
					Randomize question order for each respondent
				</label>
			</div>
			<div class="aggregate-opt">
				<label class="inline-label">
					<input
						type="checkbox"
						checked={config.nameMode === 'required'}
						onchange={(e) =>
							(config = {
								...config,
								nameMode: (e.target as HTMLInputElement).checked ? 'required' : 'disabled'
							})}
						disabled={phase === 'publishing'}
					/>
					Require respondents to enter their name before starting
				</label>
			</div>
		</section>

		<!-- Questions -->
		<section class="card">
			<div class="section-header">
				<h2>Questions ({config.questions.length}/{MAX_QUESTIONS})</h2>
				<div class="actions">
					<button
						class="ghost"
						onclick={() => (batchOpen = !batchOpen)}
						disabled={phase === 'publishing'}
					>
						{batchOpen ? 'Close batch' : 'Batch import'}
					</button>
					<button
						class="primary"
						onclick={addQuestion}
						disabled={config.questions.length >= MAX_QUESTIONS || phase === 'publishing'}
					>
						+ Add
					</button>
				</div>
			</div>

			{#if batchOpen}
				<div class="batch-area">
					<textarea bind:value={batchText} rows={6} placeholder="One question per line…"></textarea>
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
							disabled={phase === 'publishing'}
						/>
						<button
							class="danger-btn"
							onclick={() => removeQuestion(i)}
							disabled={phase === 'publishing'}
							aria-label="Remove">✕</button
						>
					</li>
				{/each}
			</ol>

			{#if config.questions.length === 0}
				<p class="empty-hint">No questions yet.</p>
			{/if}
		</section>

		<!-- Advanced -->
		<section class="card">
			<button
				class="advanced-toggle"
				onclick={() => (advancedOpen = !advancedOpen)}
				disabled={phase === 'publishing'}
			>
				{advancedOpen ? '− Advanced options' : '+ Advanced options'}
			</button>
			{#if advancedOpen}
				<div class="advanced-body">
					<label class="adv-label">
						<span>Relay confirmation threshold</span>
						<p class="hint">
							Number of relays that must accept each answer before showing a green status to
							respondents. Default: 2.
						</p>
						<input
							type="number"
							min={1}
							max={20}
							value={config.confirmThreshold}
							oninput={(e) =>
								(config = {
									...config,
									confirmThreshold: Math.max(1, parseInt((e.target as HTMLInputElement).value) || 2)
								})}
						/>
					</label>
					<label class="adv-label" style="margin-top:1rem">
						<span>Relays</span>
						<p class="hint">One relay URL per line. Applies to all forms on this device.</p>
						<textarea
							rows={8}
							bind:value={relayText}
							onblur={applyRelays}
							placeholder="wss://relay.example.com"
						></textarea>
					</label>
				</div>
			{/if}
		</section>

		<!-- Publish -->
		<section class="card publish-card">
			{#if phase === 'building'}
				<div class="publish-row">
					<button
						class="primary publish-btn"
						onclick={publish}
						disabled={config.questions.length === 0}
					>
						Publish form
					</button>
					<p class="publish-warn">
						Once published, the form cannot be changed. This keeps it reliable and free to host.
					</p>
				</div>
				{#if config.questions.length === 0}
					<p class="hint">Add at least one question to publish.</p>
				{/if}
			{:else}
				<!-- publishing phase: relay confirmations -->
				<h2>Publishing to relays…</h2>
				<div class="relay-confirm-list">
					{#each relayConfirms as r}
						<div class="relay-confirm-row">
							<span
								class="dot"
								class:ok={r.status === 'ok'}
								class:fail={r.status === 'fail'}
								class:pending={r.status === 'pending'}
							></span>
							<span class="relay-url">{r.url}</span>
							<span class="relay-status-text">
								{#if r.status === 'ok'}✓{:else if r.status === 'fail'}✗{:else}…{/if}
							</span>
						</div>
					{/each}
				</div>
				<p class="confirm-count">
					{acceptedCount} / {relayConfirms.length} confirmed
					{#if acceptedCount >= MIN_CONFIRMED}
						<span class="ok-text">— sufficient</span>
					{/if}
				</p>
			{/if}
		</section>
	{:else if phase === 'done'}
		<section class="card result-card">
			<div class="result-icon">✓</div>
			<h2>Form published</h2>
			{#if acceptedCount < MIN_CONFIRMED}
				<p class="warn-text">
					Only {acceptedCount} relay{acceptedCount !== 1 ? 's' : ''} confirmed. The form may not be reachable
					for some respondents. You can re-publish later from the admin page.
				</p>
			{:else}
				<p class="hint">Confirmed on {acceptedCount} relays.</p>
			{/if}
			<div class="link-row">
				<span class="link-text">{shareLink}</span>
				<button class="primary" onclick={() => navigator.clipboard.writeText(shareLink)}>
					Copy
				</button>
			</div>
			<p class="hint">Share this link with respondents.</p>
			<a class="primary admin-link" href={`${base}/admin#${publishedPubkey}`}>Open admin →</a>
		</section>
	{:else if phase === 'failed'}
		<section class="card result-card">
			<div class="result-icon fail-icon">✗</div>
			<h2>Publish failed</h2>
			<p class="error">{publishError}</p>
			<div class="relay-confirm-list">
				{#each relayConfirms as r}
					<div class="relay-confirm-row">
						<span class="dot" class:ok={r.status === 'ok'} class:fail={r.status === 'fail'}></span>
						<span class="relay-url">{r.url}</span>
					</div>
				{/each}
			</div>
			<button class="primary" onclick={retryPublish}>Edit and retry</button>
		</section>
	{/if}
</PageLayout>

<style>
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

	.advanced-toggle {
		background: none;
		border: none;
		padding: 0;
		font-size: 0.875rem;
		color: var(--text-muted);
		cursor: pointer;
		text-align: left;
	}

	.advanced-body {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}

	.adv-label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.875rem;
	}

	.adv-label input[type='number'] {
		width: 5rem;
	}

	.publish-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.publish-row {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.publish-btn {
		font-size: 1rem;
		padding: 0.75rem 1.75rem;
		flex-shrink: 0;
	}

	.publish-warn {
		font-size: 0.8125rem;
		color: var(--warning);
		margin: 0;
		max-width: 28rem;
		line-height: 1.5;
		align-self: center;
	}

	/* Relay confirmation */
	.relay-confirm-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		width: 100%;
	}

	.relay-confirm-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
	}

	.relay-url {
		font-family: ui-monospace, monospace;
		color: var(--text-muted);
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.relay-status-text {
		font-size: 0.75rem;
		width: 1rem;
		text-align: center;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		background: var(--border);
	}

	.dot.ok {
		background: var(--success);
	}

	.dot.fail {
		background: var(--danger);
	}

	.dot.pending {
		background: var(--text-muted);
		opacity: 0.4;
	}

	.confirm-count {
		font-size: 0.8125rem;
		color: var(--text-muted);
		margin: 0.25rem 0 0;
	}

	.ok-text {
		color: var(--success);
	}

	/* Result card */
	.result-card {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		align-items: flex-start;
	}

	.result-icon {
		font-size: 2.5rem;
		color: var(--success);
	}

	.fail-icon {
		color: var(--danger);
	}

	.result-card h2 {
		margin: 0;
	}

	.warn-text {
		font-size: 0.875rem;
		color: var(--warning);
		margin: 0;
	}

	.link-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
		width: 100%;
	}

	.link-text {
		flex: 1;
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
		word-break: break-all;
		color: var(--text-muted);
	}

	.admin-link {
		display: inline-block;
		text-decoration: none;
		padding: 0.5rem 1.25rem;
		border-radius: 6px;
		font-size: 0.875rem;
	}

	@media (max-width: 480px) {
		.labels-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
