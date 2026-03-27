<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Spring } from 'svelte/motion';
	import { NostrPool, generateKeypair } from '$lib/nostr';
	import { decryptConfig } from '$lib/crypto';
	import { randomName } from '$lib/names';
	import { DEFAULT_CONFIG, type FormConfig, type SwipeDirection } from '$lib/types';

	type Phase = 'loading' | 'surveying' | 'done' | 'error';

	let phase: Phase = $state('loading');
	let errorMsg = $state('');
	let config: FormConfig = $state({ ...DEFAULT_CONFIG });
	let currentIndex = $state(0);
	let cardShown = $state(true);
	let swipeDir: SwipeDirection | null = $state(null);
	let hintVisible = $state(true);

	const sessionId = crypto.randomUUID();
	const name = randomName();
	const { privkeyHex: ephemeralPrivkey, pubkey: ephemeralPubkey } = generateKeypair();
	void ephemeralPubkey; // used only for signing events inside NostrPool

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
				config = JSON.parse(json);
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

		// timeout if no config arrives
		setTimeout(() => {
			if (phase === 'loading') {
				errorMsg = 'Could not load form. The relay pool may be unreachable, or the form may not exist.';
				phase = 'error';
			}
		}, 12000);
	}

	function directionFromOffset(dx: number, dy: number): SwipeDirection | null {
		const ax = Math.abs(dx);
		const ay = Math.abs(dy);
		if (ax < SWIPE_THRESHOLD && ay < SWIPE_THRESHOLD) return null;
		if (ax >= ay) return dx > 0 ? 'Right' : 'Left';
		return dy > 0 ? 'Down' : 'Up';
	}

	function highlightFor(dir: SwipeDirection | null): { left: number; right: number; up: number; down: number } {
		const mk = (d: SwipeDirection) => {
			const { x, y } = motion.current;
			if (dir !== d) return 0;
			if (d === 'Left' || d === 'Right') return Math.min(Math.abs(x) / HL_DIV, MAX_HL);
			return Math.min(Math.abs(y) / HL_DIV, MAX_HL);
		};
		return { left: mk('Left'), right: mk('Right'), up: mk('Up'), down: mk('Down') };
	}

	async function swipe(dir: SwipeDirection) {
		if (!cardShown || phase !== 'surveying') return;
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
			setTimeout(() => { phase = 'done'; }, 400);
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
		const map: Record<string, SwipeDirection> = {
			ArrowLeft: 'Left', a: 'Left',
			ArrowRight: 'Right', d: 'Right',
			ArrowUp: 'Up', w: 'Up',
			ArrowDown: 'Down', s: 'Down'
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
				<p class="muted">Your answers have been submitted.</p>
			</div>
		</div>

	{:else if phase === 'surveying'}
		<div class="survey">
			<!-- direction labels -->
			<div class="label left" style="opacity: {hl.left}">{config.swipeLeftLabel}</div>
			<div class="label right" style="opacity: {hl.right}">{config.swipeRightLabel}</div>
			<div class="label up" style="opacity: {hl.up}">{config.swipeUpLabel}</div>
			<div class="label down" style="opacity: {hl.down}">{config.swipeDownLabel}</div>

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
							<div class="stamp stamp-yes" style="opacity: {hl.right}">{config.swipeRightLabel}</div>
						{:else if swipeDir === 'Left'}
							<div class="stamp stamp-no" style="opacity: {hl.left}">{config.swipeLeftLabel}</div>
						{:else if swipeDir === 'Up'}
							<div class="stamp stamp-up" style="opacity: {hl.up}">{config.swipeUpLabel}</div>
						{:else if swipeDir === 'Down'}
							<div class="stamp stamp-down" style="opacity: {hl.down}">{config.swipeDownLabel}</div>
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

			<div class="btn-row">
				<button class="dir-btn left-btn" onclick={() => swipe('Left')}>{config.swipeLeftLabel}</button>
				<button class="dir-btn up-btn" onclick={() => swipe('Up')}>{config.swipeUpLabel}</button>
				<button class="dir-btn down-btn" onclick={() => swipe('Down')}>{config.swipeDownLabel}</button>
				<button class="dir-btn right-btn" onclick={() => swipe('Right')}>{config.swipeRightLabel}</button>
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

	.survey {
		position: relative;
		width: 100%;
		max-width: 420px;
		height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.5rem;
		padding: 2rem 1rem;
		user-select: none;
	}

	.label {
		position: absolute;
		font-size: 1.25rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		pointer-events: none;
		transition: opacity 0.1s;
	}

	.label.left {
		left: 1rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--danger);
	}

	.label.right {
		right: 1rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--success);
	}

	.label.up {
		top: 1.5rem;
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

	.card-area {
		position: relative;
		width: 100%;
		height: 340px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.card {
		position: absolute;
		width: 100%;
		max-width: 360px;
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
		font-size: 1.25rem;
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
	}

	.btn-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		justify-content: center;
	}

	.dir-btn {
		font-size: 0.8125rem;
		font-weight: 600;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		background: var(--surface2);
		border: 1px solid var(--border);
		color: var(--text);
		cursor: pointer;
		transition: background 0.15s;
	}

	.dir-btn:hover {
		background: var(--surface);
	}

	.left-btn { color: var(--danger); border-color: var(--danger); }
	.right-btn { color: var(--success); border-color: var(--success); }
	.up-btn { color: var(--info); border-color: var(--info); }
	.down-btn { color: var(--warning); border-color: var(--warning); }
</style>
