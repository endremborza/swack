<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Spring } from 'svelte/motion';
	import type { DirectionLabels, SwipeDirection } from '$lib/types';

	interface Props {
		labels: DirectionLabels;
		question: string;
		index: number;
		total: number;
		onSwipe: (dir: SwipeDirection) => void;
	}

	let { labels, question, index, total, onSwipe }: Props = $props();

	const SWIPE_THRESHOLD = 90;
	const FLY = 1100;
	const HL_DIV = 140;
	const MAX_HL = 0.8;
	const ADVANCE_MS = 400;

	let cardShown = $state(true);
	let swipeDir: SwipeDirection | null = $state(null);
	let hintVisible = $state(true);
	let advanceTimer: ReturnType<typeof setTimeout> | null = null;

	const motion = new Spring(
		{ x: 0, y: 0, rotation: 0, opacity: 1 },
		{ stiffness: 0.4, damping: 0.8 }
	);

	let dragStartX = 0;
	let dragStartY = 0;
	let dragging = false;

	function labelOf(dir: SwipeDirection): string {
		return { Left: labels.left, Right: labels.right, Up: labels.up, Down: labels.down }[dir];
	}

	function isEnabled(dir: SwipeDirection): boolean {
		return labelOf(dir) !== '';
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

	function swipe(dir: SwipeDirection) {
		if (!cardShown || !isEnabled(dir)) return;
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

		const wasLast = index + 1 >= total;
		onSwipe(dir);
		if (wasLast) return;

		advanceTimer = setTimeout(() => {
			motion.set({ x: 0, y: 0, rotation: 0, opacity: 1 }, { hard: true });
			swipeDir = null;
			cardShown = true;
		}, ADVANCE_MS);
	}

	function handleKeyDown(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
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

	function applyDragOffset(dx: number, dy: number) {
		motion.set({ x: dx, y: dy, rotation: dx * 0.08, opacity: 1 });
		swipeDir = directionFromOffset(dx, dy);
	}

	function finishDrag(dx: number, dy: number) {
		dragging = false;
		const dir = directionFromOffset(dx, dy);
		if (dir) {
			swipe(dir);
		} else {
			motion.set({ x: 0, y: 0, rotation: 0, opacity: 1 });
			swipeDir = null;
		}
	}

	function handleMouseDown(e: MouseEvent) {
		dragStartX = e.clientX;
		dragStartY = e.clientY;
		dragging = true;
	}

	function handleMouseMove(e: MouseEvent) {
		if (!dragging) return;
		applyDragOffset(e.clientX - dragStartX, e.clientY - dragStartY);
	}

	function handleMouseUp(e: MouseEvent) {
		if (!dragging) return;
		finishDrag(e.clientX - dragStartX, e.clientY - dragStartY);
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
		applyDragOffset(t.clientX - dragStartX, t.clientY - dragStartY);
	}

	function handleTouchEnd(e: TouchEvent) {
		if (!dragging) return;
		const t = e.changedTouches[0];
		finishDrag(t.clientX - dragStartX, t.clientY - dragStartY);
	}

	onDestroy(() => {
		if (advanceTimer) clearTimeout(advanceTimer);
	});

	const hl = $derived(highlightFor(swipeDir));
</script>

<svelte:window onkeydown={handleKeyDown} onmousemove={handleMouseMove} onmouseup={handleMouseUp} />

<!-- Renders inside a positioned, sized ancestor (the page's play area). -->

{#if isEnabled('Left')}
	<div class="label left" style="opacity: {hl.left}">{labels.left}</div>
{/if}
{#if isEnabled('Right')}
	<div class="label right" style="opacity: {hl.right}">{labels.right}</div>
{/if}
{#if isEnabled('Up')}
	<div class="label up" style="opacity: {hl.up}">{labels.up}</div>
{/if}
{#if isEnabled('Down')}
	<div class="label down" style="opacity: {hl.down}">{labels.down}</div>
{/if}

{#if isEnabled('Up')}
	<button class="btn-dir btn-up" onclick={() => swipe('Up')}>↑ {labels.up}</button>
{/if}
{#if isEnabled('Left')}
	<button class="btn-dir btn-left" onclick={() => swipe('Left')}>{labels.left}</button>
{/if}
{#if isEnabled('Right')}
	<button class="btn-dir btn-right" onclick={() => swipe('Right')}>{labels.right}</button>
{/if}
{#if isEnabled('Down')}
	<button class="btn-dir btn-down" onclick={() => swipe('Down')}>↓ {labels.down}</button>
{/if}

<div class="card-area">
	{#if cardShown}
		<div
			class="card"
			style="transform: translate({motion.current.x}px, {motion.current.y}px) rotate({motion.current
				.rotation}deg); opacity: {motion.current.opacity};"
			onmousedown={handleMouseDown}
			ontouchstart={handleTouchStart}
			ontouchmove={handleTouchMove}
			ontouchend={handleTouchEnd}
			role="button"
			tabindex="0"
		>
			{#if swipeDir === 'Right'}
				<div class="stamp stamp-yes" style="opacity: {hl.right}">{labels.right}</div>
			{:else if swipeDir === 'Left'}
				<div class="stamp stamp-no" style="opacity: {hl.left}">{labels.left}</div>
			{:else if swipeDir === 'Up'}
				<div class="stamp stamp-up" style="opacity: {hl.up}">{labels.up}</div>
			{:else if swipeDir === 'Down'}
				<div class="stamp stamp-down" style="opacity: {hl.down}">{labels.down}</div>
			{/if}

			<p class="question">{question}</p>

			{#if hintVisible}
				<p class="hint">Swipe or use arrow keys</p>
			{/if}
		</div>
	{/if}
</div>

<div class="progress">
	{index + 1} / {total}
</div>

<style>
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
