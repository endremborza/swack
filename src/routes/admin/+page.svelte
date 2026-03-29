<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import PageLayout from '$lib/components/PageLayout.svelte';
	import { NostrPool } from '$lib/nostr';
	import { encryptConfig, decryptConfig } from '$lib/crypto';
	import { getAdmin, saveAnswer, getAnswersForForm } from '$lib/store';
	import { base } from '$app/paths';
	import { getRelays, setRelays, resetRelays } from '$lib/relays';
	import { DEFAULT_CONFIG, type FormConfig, type AdminRecord, type AnswerRecord } from '$lib/types';

	type Phase = 'loading' | 'ready' | 'not-found';

	let phase: Phase = $state('loading');
	let record: AdminRecord | null = $state(null);
	let config: FormConfig = $state({ ...DEFAULT_CONFIG });
	let answers: AnswerRecord[] = $state([]);
	let copied = $state(false);
	let relayStatus: { url: string; ok: boolean }[] = $state([]);
	let relayEditing = $state(false);
	let relayText = $state('');
	let showCredentials = $state(false);
	let credCopied = $state('');

	let pool: NostrPool | null = null;
	let unsubAnswers: (() => void) | null = null;
	let aggPublishTimer: ReturnType<typeof setTimeout> | null = null;

	type SortCol = 'idx' | 'score' | 'votes';
	let sortCol: SortCol = $state('idx');
	let sortDir: 1 | -1 = $state(1);

	const connectedCount = $derived(relayStatus.filter((r) => r.ok).length);
	const aggregate = $derived(computeAggregate());
	const sortedAggregate = $derived(
		aggregate
			? [...aggregate].sort((a, b) => (a[sortCol] - b[sortCol]) * sortDir)
			: null
	);

	function toggleSort(col: SortCol) {
		if (sortCol === col) {
			sortDir = sortDir === 1 ? -1 : 1;
		} else {
			sortCol = col;
			sortDir = col === 'idx' ? 1 : -1;
		}
	}

	function fillUrl(): string {
		if (!record) return '';
		return `${window.location.origin}${base}/fill#${record.pubkey}_${record.configAesKey}`;
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
			{ pubkey: record.pubkey, privkeyHex: record.privkeyHex, configAesKey: record.configAesKey, name: record.name },
			null,
			2
		);
		await navigator.clipboard.writeText(json);
		credCopied = 'json';
		setTimeout(() => (credCopied = ''), 2000);
	}

	function computeAggregate(): { question: string; score: number; votes: number; idx: number }[] | null {
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
			return { question: q, score, votes: relevant.length, idx: i };
		});
	}

	async function doPublishAggregate() {
		if (!pool || !record || config.aggregateVisibility === 'admin-only' || !aggregate) return;
		try {
			const json = JSON.stringify({ updatedAt: Date.now(), questions: aggregate });
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

	function rowsToCsv(rows: string[][]): string {
		return rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
	}

	function exportCsv(content: string, filename: string) {
		const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	function downloadAnswersCsv() {
		const rows = [['session_id', 'name', 'q_index', 'question', 'answer', 'timestamp']];
		for (const a of answers) {
			rows.push([
				a.sessionId,
				a.name,
				String(a.qIndex + 1),
				config.questions[a.qIndex] ?? '',
				a.answer,
				new Date(a.timestamp).toISOString()
			]);
		}
		exportCsv(rowsToCsv(rows), 'answers.csv');
	}

	function downloadAggregateCsv() {
		if (!aggregate) return;
		const rows = [['q_index', 'question', 'score', 'votes']];
		for (let i = 0; i < aggregate.length; i++) {
			rows.push([String(i + 1), aggregate[i].question, String(aggregate[i].score), String(aggregate[i].votes)]);
		}
		exportCsv(rowsToCsv(rows), 'aggregate.csv');
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
		pool.onRelayStatusChange = (status) => {
			relayStatus = [...status];
		};
		await pool.connect();
		relayStatus = [...pool.relayStatus];

		pool.subscribeConfig(pubkey, async (encryptedContent) => {
			try {
				const json = await decryptConfig(encryptedContent, admin.configAesKey);
				config = { ...DEFAULT_CONFIG, ...JSON.parse(json) };
			} catch {
				// ignore malformed
			}
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
		if (aggPublishTimer) clearTimeout(aggPublishTimer);
	});
</script>

<svelte:head>
	<title>{config.name ? `${config.name} — Admin` : 'Admin'} — Swack</title>
</svelte:head>

{#if phase === 'loading'}
	<div class="center"><span class="muted">Loading…</span></div>
{:else if phase === 'not-found'}
	<div class="center">
		<p class="muted">Form not found in this browser. <a href="{base}/">Go home</a></p>
	</div>
{:else if phase === 'ready' && record}
	<PageLayout subtitle={config.name || 'Admin'}>
		{#snippet headerEnd()}
			<div class="relay-indicator" title="{connectedCount}/{relayStatus.length} relays connected">
				<span class="dot" class:ok={connectedCount >= 3}></span>
				{connectedCount}/{relayStatus.length} relays
			</div>
		{/snippet}
			<!-- Share link -->
			<section class="card">
				<h2>Share link</h2>
				<div class="link-row">
					<span class="link-text">{fillUrl()}</span>
					<button class="primary" onclick={copyLink}>{copied ? 'Copied!' : 'Copy'}</button>
				</div>
				<p class="hint">Anyone with this link can fill out the survey.</p>
			</section>

			<!-- Form info (read-only) -->
			<section class="card">
				<h2>Form</h2>
				<dl class="form-info">
					<dt>Name</dt>
					<dd>{config.name || 'Untitled'}</dd>
					<dt>Questions</dt>
					<dd>{config.questions.length}</dd>
					<dt>Swipe labels</dt>
					<dd class="labels-row">
						{#if config.swipeLeftLabel}<span class="label-chip left">← {config.swipeLeftLabel}</span>{/if}
						{#if config.swipeRightLabel}<span class="label-chip right">→ {config.swipeRightLabel}</span>{/if}
						{#if config.swipeUpLabel}<span class="label-chip up">↑ {config.swipeUpLabel}</span>{/if}
						{#if config.swipeDownLabel}<span class="label-chip down">↓ {config.swipeDownLabel}</span>{/if}
					</dd>
					<dt>Settings</dt>
					<dd>
						{config.randomizeOrder ? 'Randomized order' : 'Fixed order'} ·
						{config.aggregateVisibility === 'on-completion'
							? 'Aggregate shown on completion'
							: 'Aggregate admin-only'} ·
						confirm ≥{config.confirmThreshold} relays
					</dd>
				</dl>
				<p class="hint">Form config is immutable after publish. <a href="{base}/create">Create a new form →</a></p>
			</section>

			<!-- Multi-device access -->
			<section class="card">
				<h2>Admin access on other devices</h2>
				<p class="hint">
					Your private key lives only in this browser. Export credentials to access this form on
					another device.
				</p>
				<button class="ghost" onclick={() => (showCredentials = !showCredentials)}>
					{showCredentials ? 'Hide credentials' : 'Export credentials'}
				</button>
				{#if showCredentials}
					<div class="cred-box">
						<p class="cred-warn">
							Anyone with the private key can decrypt all answers. Store securely.
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

			<!-- Aggregate scores -->
			{#if sortedAggregate}
				<section class="card">
					<div class="section-header">
						<h2>Aggregate scores</h2>
						<button class="ghost" onclick={downloadAggregateCsv}>Export CSV</button>
					</div>
					<p class="hint">Numeric directions: {numericLabelsSummary()}</p>
					<table>
						<thead>
							<tr>
								<th class="sortable" onclick={() => toggleSort('idx')}>
									#{sortCol === 'idx' ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
								</th>
								<th>Question</th>
								<th class="sortable" onclick={() => toggleSort('score')}>
									Score{sortCol === 'score' ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
								</th>
								<th class="sortable" onclick={() => toggleSort('votes')}>
									Votes{sortCol === 'votes' ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
								</th>
							</tr>
						</thead>
						<tbody>
							{#each sortedAggregate as row}
								<tr>
									<td class="mono">{row.idx + 1}</td>
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
				<div class="section-header">
					<h2>Responses ({answers.length})</h2>
					{#if answers.length > 0}
						<button class="ghost" onclick={downloadAnswersCsv}>Export CSV</button>
					{/if}
				</div>
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
						One relay URL per line. Applies to all forms on this device.
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
	</PageLayout>
{/if}

<style>
	.center {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100dvh;
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

	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 1.5rem;
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

	/* Form info */
	.form-info {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.4rem 1.25rem;
		font-size: 0.875rem;
		margin: 0;
	}

	dt {
		color: var(--text-muted);
		font-size: 0.8125rem;
		align-self: start;
		padding-top: 0.1rem;
	}

	dd {
		margin: 0;
	}

	.labels-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.label-chip {
		font-size: 0.75rem;
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--border);
		background: var(--surface2);
	}

	.label-chip.left { color: var(--danger); }
	.label-chip.right { color: var(--success); }
	.label-chip.up { color: var(--info); }
	.label-chip.down { color: var(--warning); }

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

	th.sortable {
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
	}

	th.sortable:hover {
		color: var(--text);
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
</style>
