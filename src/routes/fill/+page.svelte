<script lang="ts">
	import { onMount } from 'svelte';
	import { Spring } from 'svelte/motion';
	import { tick } from 'svelte';
	import { scale } from 'svelte/transition';
	import { randomName } from '$lib/names';

	type Phase = 'loading' | 'naming' | 'surveying' | 'done' | 'error';
	type Direction = 'left' | 'right' | 'up' | 'down';

	interface FormConfig {
		formTitle?: string;
		swipeLeftLabel?: string;
		swipeRightLabel?: string;
		swipeUpLabel?: string;
		swipeDownLabel?: string;
	}

	let phase: Phase = $state('loading');
	let errorMsg = $state('');
	let config: FormConfig = $state({});
	let questions: string[] = $state([]);
	let userName = $state('');
	let currentIndex = $state(0);
	let cardShown = $state(true);
	let cardInteracting = $state(false);
	let swipeDir: Direction | null = $state(null);
	let hintVisible = $state(true);

	const sessionId = crypto.randomUUID();
	let gasUrl = '';

	const motion = new Spring(
		{ x: 0, y: 0, rotation: 0, opacity: 1 },
		{ stiffness: 0.4, damping: 0.8 }
	);

	let dragStartX = 0;
	let dragStartY = 0;

	const SWIPE_THRESHOLD = 90;
	const FLY = 1100;
	const HL_DIV = 140;
	const MAX_HL = 0.8;

	onMount(() => {
		const hash = window.location.hash.slice(1);
		if (!hash) {
			errorMsg = 'No form URL in this link. Make sure you used a valid Swack share link.';
			phase = 'error';
			return;
		}
		try {
			gasUrl = atob(hash);
		} catch {
			errorMsg = 'This link appears to be malformed.';
			phase = 'error';
			return;
		}

		loadForm();
		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	});

	async function loadForm() {
		try {
			const res = await fetch(gasUrl);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			config = (data.config as FormConfig) ?? {};
			questions = (data.questions as string[]) ?? [];
			if (questions.length === 0) {
				errorMsg = 'This form has no questions.';
				phase = 'error';
				return;
			}
			phase = 'naming';
		} catch {
			errorMsg = 'Could not load the form. The URL may be invalid or the script is not deployed.';
			phase = 'error';
		}
	}

	function startSurvey() {
		const name = userName.trim();
		if (!name) return;
		userName = name;
		phase = 'surveying';
	}

	function labelFor(dir: Direction): string {
		return (
			{
				left: config.swipeLeftLabel,
				right: config.swipeRightLabel,
				up: config.swipeUpLabel,
				down: config.swipeDownLabel
			}[dir] ?? ''
		);
	}

	function isActive(dir: Direction): boolean {
		return !!labelFor(dir);
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (phase !== 'surveying' || cardInteracting) return;
		const map: Record<string, Direction> = {
			ArrowLeft: 'left', a: 'left',
			ArrowRight: 'right', d: 'right',
			ArrowUp: 'up', w: 'up',
			ArrowDown: 'down', s: 'down'
		};
		const dir = map[e.key];
		if (dir && isActive(dir)) doSwipe(dir);
	}

	function beginDrag(x: number, y: number) {
		if (phase !== 'surveying' || cardInteracting) return;
		cardInteracting = true;
		dragStartX = x;
		dragStartY = y;
	}

	function moveDrag(x: number, y: number) {
		if (!cardInteracting || phase !== 'surveying') return;
		const dx = x - dragStartX;
		const dy = y - dragStartY;
		motion.target = { x: dx, y: dy, rotation: dx * 0.07, opacity: 1 };
		swipeDir =
			Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
	}

	function endDrag(x: number, y: number) {
		if (!cardInteracting || phase !== 'surveying') return;
		const dx = x - dragStartX;
		const dy = y - dragStartY;
		let dir: Direction | null = null;
		if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) >= Math.abs(dy))
			dir = dx > 0 ? 'right' : 'left';
		else if (Math.abs(dy) > SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx))
			dir = dy > 0 ? 'down' : 'up';

		if (dir && isActive(dir)) {
			doSwipe(dir);
		} else {
			motion.set({ x: 0, y: 0, rotation: 0, opacity: 1 });
			cardInteracting = false;
			swipeDir = null;
		}
	}

	function handleMouseMove(e: MouseEvent) {
		moveDrag(e.clientX, e.clientY);
	}
	function handleMouseUp(e: MouseEvent) {
		endDrag(e.clientX, e.clientY);
	}

	function doSwipe(dir: Direction) {
		hintVisible = false;
		cardInteracting = true;
		const targets = {
			left: { x: -FLY, y: 0, rotation: -20 },
			right: { x: FLY, y: 0, rotation: 20 },
			up: { x: 0, y: -FLY, rotation: 0 },
			down: { x: 0, y: FLY, rotation: 0 }
		};
		motion.set({ ...targets[dir], opacity: 0 }).then(() => recordAnswer(dir));
	}

	async function recordAnswer(dir: Direction) {
		fetch(gasUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: JSON.stringify({ sessionId, userName, question: questions[currentIndex], answer: dir })
		}).catch(() => {});

		if (currentIndex < questions.length - 1) {
			currentIndex++;
			cardShown = false;
			await tick();
			motion.set({ x: 0, y: 0, rotation: 0, opacity: 1 }, { instant: true });
			cardInteracting = false;
			swipeDir = null;
			cardShown = true;
		} else {
			phase = 'done';
		}
	}

	function hlOpacity(dir: Direction): number {
		if (!cardInteracting || swipeDir !== dir) return 0;
		const { x, y } = motion.current;
		switch (dir) {
			case 'left': return Math.min(MAX_HL, -x / HL_DIV);
			case 'right': return Math.min(MAX_HL, x / HL_DIV);
			case 'up': return Math.min(MAX_HL, -y / HL_DIV);
			case 'down': return Math.min(MAX_HL, y / HL_DIV);
		}
	}
</script>

<svelte:head>
	<title>{config.formTitle ?? 'Survey'} — Swack</title>
</svelte:head>

<div class="fill-page">
	{#if phase === 'loading'}
		<div class="center-screen">
			<div class="spinner"></div>
			<p>Loading form…</p>
		</div>
	{:else if phase === 'error'}
		<div class="center-screen">
			<p class="error-msg">{errorMsg}</p>
			<a href="/" class="btn-link">← Back to Swack</a>
		</div>
	{:else if phase === 'naming'}
		<div class="center-screen card-panel naming-screen" in:scale={{ duration: 250, start: 0.95 }}>
			<h1>{config.formTitle ?? 'Survey'}</h1>
			<p class="sub">{questions.length} question{questions.length !== 1 ? 's' : ''} · swipe to answer</p>
			<div class="name-row">
				<input
					type="text"
					bind:value={userName}
					placeholder="Your name"
					maxlength="40"
					onkeydown={(e) => e.key === 'Enter' && startSurvey()}
					autofocus
				/>
				<button class="btn-random" title="Random name" onclick={() => (userName = randomName())}>
					↺
				</button>
			</div>
			<button class="btn-start" onclick={startSurvey} disabled={!userName.trim()}>Start</button>
		</div>
	{:else if phase === 'surveying'}
		<div class="hl hl-left" style="opacity: {hlOpacity('left')}"></div>
		<div class="hl hl-right" style="opacity: {hlOpacity('right')}"></div>
		<div class="hl hl-up" style="opacity: {hlOpacity('up')}"></div>
		<div class="hl hl-down" style="opacity: {hlOpacity('down')}"></div>

		<div class="swipe-layout">
			<div class="dir-hints">
				{#each (['up', 'left', 'right', 'down'] as Direction[]) as dir}
					{#if isActive(dir)}
						<div class="dir-hint hint-{dir}" class:hint-active={swipeDir === dir && cardInteracting}>
							{dir === 'left' ? '← ' : dir === 'up' ? '↑ ' : ''}{labelFor(dir)}{dir === 'right' ? ' →' : dir === 'down' ? ' ↓' : ''}
						</div>
					{/if}
				{/each}
			</div>

			{#if cardShown}
				<div
					class="card"
					style="transform: translate({motion.current.x}px, {motion.current.y}px) rotate({motion.current.rotation}deg); opacity: {motion.current.opacity};"
					in:scale={{ duration: 280, start: 0.88 }}
					ontouchstart={(e) => beginDrag(e.touches[0].clientX, e.touches[0].clientY)}
					ontouchmove={(e) => moveDrag(e.touches[0].clientX, e.touches[0].clientY)}
					ontouchend={(e) => endDrag(e.changedTouches[0].clientX, e.changedTouches[0].clientY)}
					onmousedown={(e) => beginDrag(e.clientX, e.clientY)}
					role="button"
					tabindex="0"
				>
					{#each (['left', 'right', 'up', 'down'] as Direction[]) as dir}
						{#if isActive(dir)}
							<div class="stamp stamp-{dir}" style="opacity: {hlOpacity(dir)}">
								{labelFor(dir)}
							</div>
						{/if}
					{/each}

					<p class="question-count">{currentIndex + 1} / {questions.length}</p>
					<p class="question-text">{questions[currentIndex]}</p>
				</div>
			{/if}

			<div class="progress-track">
				<div class="progress-fill" style="width: {((currentIndex + 1) / questions.length) * 100}%"></div>
			</div>

			{#if hintVisible}
				<p class="swipe-hint">swipe or use arrow keys</p>
			{/if}
		</div>
	{:else if phase === 'done'}
		<div class="center-screen card-panel done-screen" in:scale={{ duration: 300, start: 0.9 }}>
			<div class="done-icon">✓</div>
			<h2>All done!</h2>
			<p>Your responses have been recorded. Thank you, {userName}!</p>
		</div>
	{/if}
</div>

<style>
	:global(body) {
		background: #f0f2f5;
	}

	.fill-page {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}

	.center-screen {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		text-align: center;
		padding: 1.5rem;
		max-width: 420px;
		width: 100%;
	}

	.card-panel {
		background: white;
		border-radius: 20px;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.1);
		padding: 2.5rem 2rem;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid #e2e8f0;
		border-top-color: #2563eb;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.error-msg { color: #dc2626; margin: 0; }

	.btn-link {
		color: #2563eb;
		text-decoration: none;
		font-size: 0.9375rem;
	}

	.btn-link:hover { text-decoration: underline; }

	.naming-screen h1 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0 0 0.25rem;
	}

	.sub {
		font-size: 0.875rem;
		color: #94a3b8;
		margin: 0 0 1.75rem;
	}

	.name-row {
		display: flex;
		gap: 0.5rem;
		width: 100%;
		margin-bottom: 1rem;
	}

	.name-row input {
		flex: 1;
		padding: 0.625rem 0.875rem;
		border: 1.5px solid #e2e8f0;
		border-radius: 10px;
		font-size: 1rem;
		color: #0f172a;
		background: #f8fafc;
		outline: none;
		transition: border-color 0.15s;
	}

	.name-row input:focus {
		border-color: #2563eb;
		background: white;
	}

	.btn-random {
		width: 42px;
		height: 42px;
		border-radius: 10px;
		border: 1.5px solid #e2e8f0;
		background: #f8fafc;
		font-size: 1.2rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s;
		flex-shrink: 0;
	}

	.btn-random:hover { background: #e2e8f0; }

	.btn-start {
		width: 100%;
		padding: 0.75rem;
		background: #2563eb;
		color: white;
		border: none;
		border-radius: 10px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s, opacity 0.15s;
	}

	.btn-start:hover:not(:disabled) { background: #1d4ed8; }
	.btn-start:disabled { opacity: 0.45; cursor: not-allowed; }

	.hl {
		position: fixed;
		pointer-events: none;
		z-index: 5;
		transition: opacity 0.1s;
	}

	.hl-left { inset: 0 auto 0 0; width: 35%; background: linear-gradient(to right, rgba(239, 68, 68, 0.45), transparent); }
	.hl-right { inset: 0 0 0 auto; width: 35%; background: linear-gradient(to left, rgba(34, 197, 94, 0.45), transparent); }
	.hl-up { inset: 0 0 auto 0; height: 35%; background: linear-gradient(to bottom, rgba(59, 130, 246, 0.45), transparent); }
	.hl-down { inset: auto 0 0 0; height: 35%; background: linear-gradient(to top, rgba(234, 179, 8, 0.45), transparent); }

	.swipe-layout {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		z-index: 10;
	}

	.dir-hints {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.dir-hint {
		position: absolute;
		font-size: 0.8125rem;
		font-weight: 600;
		color: #94a3b8;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		transition: color 0.15s;
		white-space: nowrap;
	}

	.hint-up    { top: 10%;    left: 50%; translate: -50% 0; }
	.hint-down  { bottom: 14%; left: 50%; translate: -50% 0; }
	.hint-left  { left: 4%;    top: 50%;  translate: 0 -50%; }
	.hint-right { right: 4%;   top: 50%;  translate: 0 -50%; }

	.dir-hint.hint-active { color: #0f172a; }

	.card {
		position: relative;
		width: min(88vw, 420px);
		height: min(62vh, 380px);
		background: white;
		border-radius: 22px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 2rem 2rem 2.5rem;
		text-align: center;
		cursor: grab;
		user-select: none;
		touch-action: none;
		will-change: transform;
	}

	.card:active { cursor: grabbing; }

	.question-count {
		position: absolute;
		top: 1.25rem;
		right: 1.5rem;
		font-size: 0.8125rem;
		color: #94a3b8;
		margin: 0;
	}

	.question-text {
		font-size: clamp(1.1rem, 3.5vw, 1.5rem);
		font-weight: 600;
		line-height: 1.35;
		margin: 0;
	}

	.stamp {
		position: absolute;
		font-size: 1.125rem;
		font-weight: 800;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		border-width: 3px;
		border-style: solid;
		border-radius: 6px;
		padding: 0.2em 0.6em;
		transition: opacity 0.05s;
		pointer-events: none;
	}

	.stamp-left  { top: 1.5rem; right: 1.5rem; color: #ef4444; border-color: #ef4444; transform: rotate(12deg); }
	.stamp-right { top: 1.5rem; left: 1.5rem;  color: #22c55e; border-color: #22c55e; transform: rotate(-12deg); }
	.stamp-up    { bottom: 1.5rem; left: 50%;  color: #3b82f6; border-color: #3b82f6; transform: translateX(-50%); }
	.stamp-down  { top: 1.5rem;    left: 50%;  color: #eab308; border-color: #eab308; transform: translateX(-50%); }

	.progress-track {
		width: min(88vw, 420px);
		height: 5px;
		background: #e2e8f0;
		border-radius: 99px;
		overflow: hidden;
		margin-top: 1.25rem;
	}

	.progress-fill {
		height: 100%;
		background: #2563eb;
		transition: width 0.35s ease;
	}

	.swipe-hint {
		margin-top: 0.875rem;
		font-size: 0.8125rem;
		color: #94a3b8;
	}

	.done-screen h2 { font-size: 1.5rem; font-weight: 700; margin: 0; }
	.done-screen p  { color: #475569; margin: 0; }

	.done-icon {
		width: 56px;
		height: 56px;
		background: #22c55e;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.75rem;
		color: white;
		font-weight: 700;
	}
</style>
