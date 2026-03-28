<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Spring } from 'svelte/motion';
	import { NostrPool, generateKeypair } from '$lib/nostr';
	import { decryptConfig } from '$lib/crypto';
	import { randomName } from '$lib/names';
	import { DEFAULT_CONFIG, type FormConfig, type SwipeDirection } from '$lib/types';

	type Phase = 'loading' | 'surveying' | 'done' | 'error';

	const NAME_KEY = 'swack_name';

	function initName(): string {
		const stored = localStorage.getItem(NAME_KEY);
		if (stored) return stored;
		const fresh = randomName();
		localStorage.setItem(NAME_KEY, fresh);
		return fresh;
	}

	let phase: Phase = $state('loading');
	let errorMsg = $state('');
	let config: FormConfig = $state({ ...DEFAULT_CONFIG });
	let currentIndex = $state(0);
	let cardShown = $state(true);
	let swipeDir: SwipeDirection | null = $state(null);
	let hintVisible = $state(true);

	let name = $state(initName());
	let editingName = $state(false);
	let nameInput = $state('');

	let aggregateData: { question: string; score: number; votes: number }[] | null = $state(null);
	let aggregateLoading = $state(false);

	const sessionId = crypto.randomUUID();
	const { privkeyHex: ephemeralPrivkey, pubkey: ephemeralPubkey } = generateKeypair();
	void ephemeralPubkey;

	let serverPubkey = '';
	let configAesKey = '';
	let pool: NostrPool | null = null;

	const motion = new Spring(
		{ x: 0, y: 0, rotation: 0, opacity: 1 },
		{ stiffness: 0.4, damping: 0.8 }
	);

	let dragStartX = 0;
	let dragStartY = 0;
	let dragging = false;

	const SWIPE_THRESHOLD = 90;
	const FLY = 1100;
	const HL_DIV = 140;
	const MAX_HL = 0.8;

	function isEnabled(dir: SwipeDirection): boolean {
		const labels: Record<SwipeDirection, string> = {
			Left: config.swipeLeftLabel,
			Right: config.swipeRightLabel,
			Up: config.swipeUpLabel,
			Down: config.swipeDownLabel
		};
		return labels[dir] !== '';
	}

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

		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);

		loadForm();

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	});

	onDestroy(() => {
		pool?.destroy();
	});

	async function loadForm() {
		pool = new NostrPool();
		await pool.connect();

		const unsub = pool.subscribeConfig(serverPubkey, async (encryptedContent) => {
			try {
				const json = await decryptConfig(encryptedContent, configAesKey);
				config = { ...DEFAULT_CONFIG, ...JSON.parse(json) };
				if (config.questions.length === 0) {
					errorMsg = 'This form has no questions yet.';
					phase = 'error';
					return;
				}
				phase = 'surveying';
			} catch {
				errorMsg = 'Could not decrypt form config. The link may be malformed.';
				phase = 'error';
			}
			unsub();
		});

		setTimeout(() => {
			if (phase === 'loading') {
				errorMsg =
					'Could not load form. The relay pool may be unreachable, or the form may not exist.';
				phase = 'error';
			}
		}, 12000);
	}

	function saveName() {
		const trimmed = nameInput.trim();
		if (trimmed) {
			name = trimmed;
			localStorage.setItem(NAME_KEY, trimmed);
		}
		editingName = false;
	}

	function startEditingName() {
		nameInput = name;
		editingName = true;
	}

	function directionFromOffset(dx: number, dy: number): SwipeDirection | null {
		const ax = Math.abs(dx);
		const ay = Math.abs(dy);
		if (ax < SWIPE_THRESHOLD && ay < SWIPE_THRESHOLD) return null;
		if (ax >= ay) {
			if (dx > 0 && isEnabled('Right')) return 'Right';
			if (dx < 0 && isEnabled('Left')) return 'Left';
			return null;
		}
		if (dy > 0 && isEnabled('Down')) return 'Down';
		if (dy < 0 && isEnabled('Up')) return 'Up';
		return null;
	}

	function highlightFor(dir: SwipeDirection | null): {
		left: number;
		right: number;
		up: number;
		down: number;
	} {
		const mk = (d: SwipeDirection) => {
			const { x, y } = motion.current;
			if (dir !== d) return 0;
			if (d === 'Left' || d === 'Right') return Math.min(Math.abs(x) / HL_DIV, MAX_HL);
			return Math.min(Math.abs(y) / HL_DIV, MAX_HL);
		};
		return { left: mk('Left'), right: mk('Right'), up: mk('Up'), down: mk('Down') };
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

	async function swipe(dir: SwipeDirection) {
		if (!cardShown || phase !== 'surveying' || !isEnabled(dir)) return;
		hintVisible = false;
		swipeDir = dir;

		const targets: Record<SwipeDirection, { x: number; y: number; rotation: number }> = {
			Left: { x: -FLY, y: 0, rotation: -20 },
			Right: { x: FLY, y: 0, rotation: 20 },
			Up: { x: 0, y: -FLY, rotation: 0 },
			Down: { x: 0, y: FLY, rotation: 0 }
		};

		const { x, y, rotation } = targets[dir];
		motion.set({ x, y, rotation, opacity: 0 });
		cardShown = false;

		await submitAnswer(dir);

		if (currentIndex + 1 >= config.questions.length) {
			setTimeout(() => {
				phase = 'done';
				fetchAggregate();
			}, 400);
			return;
		}

		setTimeout(() => {
			currentIndex++;
			motion.set({ x: 0, y: 0, rotation: 0, opacity: 1 }, { hard: true });
			swipeDir = null;
			cardShown = true;
		}, 400);
	}

	async function submitAnswer(answer: SwipeDirection) {
		if (!pool) return;
		const payload = JSON.stringify({
			sessionId,
			name,
			qIndex: currentIndex,
			answer,
			timestamp: Date.now()
		});
		try {
			await pool.publishAnswer(serverPubkey, payload, ephemeralPrivkey);
		} catch {
			// best-effort — continue survey even if publish fails
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (editingName) return;
		const map: Record<string, SwipeDirection> = {
			ArrowLeft: 'Left',
			a: 'Left',
			ArrowRight: 'Right',
			d: 'Right',
			ArrowUp: 'Up',
			w: 'Up',
			ArrowDown: 'Down',
			s: 'Down'
		};
		const dir = map[e.key];
		if (dir) swipe(dir);
	}

	function handleMouseDown(e: MouseEvent) {
		dragStartX = e.clientX;
		dragStartY = e.clientY;
		dragging = true;
	}

	function handleMouseMove(e: MouseEvent) {
		if (!dragging) return;
		const dx = e.clientX - dragStartX;
		const dy = e.clientY - dragStartY;
		const rot = dx * 0.08;
		motion.set({ x: dx, y: dy, rotation: rot, opacity: 1 });
		swipeDir = directionFromOffset(dx, dy);
	}

	function handleMouseUp(e: MouseEvent) {
		if (!dragging) return;
		dragging = false;
		const dx = e.clientX - dragStartX;
		const dy = e.clientY - dragStartY;
		const dir = directionFromOffset(dx, dy);
		if (dir) {
			swipe(dir);
		} else {
			motion.set({ x: 0, y: 0, rotation: 0, opacity: 1 });
			swipeDir = null;
		}
	}

	function handleTouchStart(e: TouchEvent) {
		const t = e.touches[0];
		dragStartX = t.clientX;
		dragStartY = t.clientY;
		dragging = true;
	}

	function handleTouchMove(e: TouchEvent) {
		if (!dragging) return;
		const t = e.touches[0];
		const dx = t.clientX - dragStartX;
		const dy = t.clientY - dragStartY;
		motion.set({ x: dx, y: dy, rotation: dx * 0.08, opacity: 1 });
		swipeDir = directionFromOffset(dx, dy);
	}

	function handleTouchEnd(e: TouchEvent) {
		if (!dragging) return;
		dragging = false;
		const t = e.changedTouches[0];
		const dx = t.clientX - dragStartX;
		const dy = t.clientY - dragStartY;
		const dir = directionFromOffset(dx, dy);
		if (dir) {
			swipe(dir);
		} else {
			motion.set({ x: 0, y: 0, rotation: 0, opacity: 1 });
			swipeDir = null;
		}
	}

	const hl = $derived(highlightFor(swipeDir));
</script>

<svelte:head>
	<title>Swack</title>
</svelte:head>

<div class="page">
	{#if phase === 'loading'}
		<div class="center"><span class="muted">Connecting to relay pool…</span></div>
	{:else if phase === 'error'}
		<div class="center">
			<div class="error-box">
				<p>{errorMsg}</p>
				<a href="/">← Home</a>
			</div>
		</div>
	{:else if phase === 'done'}
		<div class="center">
			<div class="done-box">
				<div class="done-icon">✓</div>
				<h2>All done!</h2>
				<p class="muted">Your answers have been submitted as <strong>{name}</strong>.</p>
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
											<td
												class:pos={row.score > 0}
												class:neg={row.score < 0}
											>
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
			<!-- Name badge -->
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

			<!-- Direction labels (appear during swipe) -->
			{#if isEnabled('Left')}
				<div class="label left" style="opacity: {hl.left}">{config.swipeLeftLabel}</div>
			{/if}
			{#if isEnabled('Right')}
				<div class="label right" style="opacity: {hl.right}">{config.swipeRightLabel}</div>
			{/if}
			{#if isEnabled('Up')}
				<div class="label up" style="opacity: {hl.up}">{config.swipeUpLabel}</div>
			{/if}
			{#if isEnabled('Down')}
				<div class="label down" style="opacity: {hl.down}">{config.swipeDownLabel}</div>
			{/if}

			<!-- Direction buttons (always visible, positionally placed) -->
			{#if isEnabled('Up')}
				<button class="btn-dir btn-up" onclick={() => swipe('Up')}>
					↑ {config.swipeUpLabel}
				</button>
			{/if}
			{#if isEnabled('Left')}
				<button class="btn-dir btn-left" onclick={() => swipe('Left')}>
					{config.swipeLeftLabel}
				</button>
			{/if}
			{#if isEnabled('Right')}
				<button class="btn-dir btn-right" onclick={() => swipe('Right')}>
					{config.swipeRightLabel}
				</button>
			{/if}
			{#if isEnabled('Down')}
				<button class="btn-dir btn-down" onclick={() => swipe('Down')}>
					↓ {config.swipeDownLabel}
				</button>
			{/if}

			<div class="card-area">
				{#if cardShown}
					<div
						class="card"
						style="transform: translate({motion.current.x}px, {motion.current.y}px) rotate({motion.current.rotation}deg); opacity: {motion.current.opacity};"
						onmousedown={handleMouseDown}
						ontouchstart={handleTouchStart}
						ontouchmove={handleTouchMove}
						ontouchend={handleTouchEnd}
						role="button"
						tabindex="0"
					>
						<!-- stamp overlays -->
						{#if swipeDir === 'Right'}
							<div class="stamp stamp-yes" style="opacity: {hl.right}">
								{config.swipeRightLabel}
							</div>
						{:else if swipeDir === 'Left'}
							<div class="stamp stamp-no" style="opacity: {hl.left}">{config.swipeLeftLabel}</div>
						{:else if swipeDir === 'Up'}
							<div class="stamp stamp-up" style="opacity: {hl.up}">{config.swipeUpLabel}</div>
						{:else if swipeDir === 'Down'}
							<div class="stamp stamp-down" style="opacity: {hl.down}">
								{config.swipeDownLabel}
							</div>
						{/if}

						<p class="question">{config.questions[currentIndex]}</p>

						{#if hintVisible}
							<p class="hint">Swipe or use arrow keys</p>
						{/if}
					</div>
				{/if}
			</div>

			<div class="progress">
				{currentIndex + 1} / {config.questions.length}
			</div>
		</div>
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

	.muted {
		color: var(--text-muted);
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

	/* Direction labels (swipe feedback) */
	.label {
		position: absolute;
		font-size: 1.25rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		pointer-events: none;
		transition: opacity 0.1s;
		z-index: 5;
	}

	.label.left {
		left: 5rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--danger);
	}

	.label.right {
		right: 5rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--success);
	}

	.label.up {
		top: 5rem;
		left: 50%;
		transform: translateX(-50%);
		color: var(--info);
	}

	.label.down {
		bottom: 5rem;
		left: 50%;
		transform: translateX(-50%);
		color: var(--warning);
	}

	/* Directional action buttons */
	.btn-dir {
		position: absolute;
		font-size: 0.8rem;
		font-weight: 700;
		padding: 0.45rem 0.9rem;
		border-radius: 8px;
		background: var(--surface2);
		border: 1px solid var(--border);
		cursor: pointer;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		z-index: 2;
		transition: background 0.15s;
		white-space: nowrap;
	}

	.btn-dir:hover {
		background: var(--surface);
	}

	.btn-up {
		top: 1rem;
		left: 50%;
		transform: translateX(-50%);
		color: var(--info);
		border-color: color-mix(in srgb, var(--info) 40%, var(--border));
	}

	.btn-down {
		bottom: 1rem;
		left: 50%;
		transform: translateX(-50%);
		color: var(--warning);
		border-color: color-mix(in srgb, var(--warning) 40%, var(--border));
	}

	.btn-left {
		left: 0.4rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 40%, var(--border));
		max-width: 62px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.btn-right {
		right: 0.4rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--success);
		border-color: color-mix(in srgb, var(--success) 40%, var(--border));
		max-width: 62px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Card area */
	.card-area {
		position: relative;
		width: 100%;
		padding: 0 5rem;
		height: 340px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.card {
		position: absolute;
		width: calc(100% - 10rem);
		max-width: 320px;
		min-height: 220px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 2rem;
		cursor: grab;
		touch-action: none;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
	}

	.card:active {
		cursor: grabbing;
	}

	.question {
		font-size: 1.2rem;
		font-weight: 500;
		line-height: 1.5;
		margin: 0 0 1rem;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--text-muted);
		margin: 0;
	}

	.stamp {
		position: absolute;
		top: 1rem;
		padding: 0.25rem 0.75rem;
		border-radius: 4px;
		font-size: 1rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		pointer-events: none;
	}

	.stamp-yes {
		right: 1rem;
		color: var(--success);
		border: 3px solid var(--success);
		transform: rotate(15deg);
	}

	.stamp-no {
		left: 1rem;
		color: var(--danger);
		border: 3px solid var(--danger);
		transform: rotate(-15deg);
	}

	.stamp-up {
		top: 1rem;
		left: 50%;
		transform: translateX(-50%);
		color: var(--info);
		border: 3px solid var(--info);
	}

	.stamp-down {
		bottom: 1rem;
		top: auto;
		left: 50%;
		transform: translateX(-50%);
		color: var(--warning);
		border: 3px solid var(--warning);
	}

	.progress {
		font-size: 0.8125rem;
		color: var(--text-muted);
		margin-top: 1rem;
	}
</style>
