<script lang="ts">
	import { onMount } from 'svelte';
	import { Spring } from 'svelte/motion';
	import { scale } from 'svelte/transition';
	import { tick } from 'svelte';

	const DIRECTION_VALUES = ['left', 'right', 'up', 'down'] as const;
	type Direction = (typeof DIRECTION_VALUES)[number];

	function isDirection(value: string): value is Direction {
		return (DIRECTION_VALUES as readonly string[]).includes(value);
	}

	let cards: { header: string; p: string | null }[] = [];
	let currentCardIndex = 0;
	let responses: { card: { header: string; p: string | null }; response: string }[] = [];
	let surveyFinished = false;

	let cardMotion = new Spring(
		{ x: 0, y: 0, rotation: 0, opacity: 1 },
		{
			stiffness: 0.4,
			damping: 0.8
		}
	);

	let cardShown = true;
	let cardInteracting = false;
	let swipeDirection: Direction | null = null;
	const swipeThreshold = 100; // pixels
	let xEdge = 800;
	let yEdge = 800;
	const hlOpacityDivisor = 150;
	const maxHLOpacity = 0.85;

	let touchStartX = 0;
	let touchStartY = 0;

	onMount(() => {
		async function loadData() {
			try {
				const response = await fetch('/test-survey.xml');
				if (!response.ok) {
					console.error(`Failed to fetch XML: ${response.status} ${response.statusText}`);
					return;
				}
				const xmlString = await response.text();
				const parser = new DOMParser();
				const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
				const cardElements = Array.from(xmlDoc.getElementsByTagName('card'));

				cards = cardElements.map((cardElement) => {
					const header = cardElement.querySelector('header')?.textContent ?? '';
					const p = cardElement.querySelector('p')?.textContent ?? null;
					return { header, p };
				});
				console.log('Cards loaded:', cards.length);
			} catch (error) {
				console.error('Error loading survey:', error);
			}
		}
		loadData();
		window.addEventListener('keydown', handleKeyDown);
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	});

	function handleKeyDown(event: KeyboardEvent) {
		if (cardInteracting || surveyFinished) return;
		let direction = event.key.replace('Arrow', '').toLowerCase();
		switch (direction) {
			case 'a':
				direction = 'left';
				break;
			case 'd':
				direction = 'right';
				break;
			case 'w':
				direction = 'up';
				break;
			case 's':
				direction = 'down';
				break;
		}
		if (isDirection(direction)) animateAndRecordResponse(direction);
	}

	function handleTouchStart(e: TouchEvent) {
		if (cardInteracting || surveyFinished) return;
		cardInteracting = true;
		touchStartX = e.touches[0].clientX;
		touchStartY = e.touches[0].clientY;
	}

	function handleTouchMove(e: TouchEvent) {
		if (!cardInteracting || surveyFinished) return;

		const touchX = e.touches[0].clientX;
		const touchY = e.touches[0].clientY;
		const deltaX = touchX - touchStartX;
		const deltaY = touchY - touchStartY;

		const rotation = deltaX * 0.1;
		cardMotion.target = { x: deltaX, y: deltaY, rotation, opacity: 1 };

		if (Math.abs(deltaX) > Math.abs(deltaY)) {
			swipeDirection = deltaX > 0 ? 'right' : 'left';
		} else {
			swipeDirection = deltaY > 0 ? 'down' : 'up';
		}
	}

	function handleTouchEnd(e: TouchEvent) {
		if (!cardInteracting || surveyFinished) return;

		const deltaX = e.changedTouches[0].clientX - touchStartX;
		const deltaY = e.changedTouches[0].clientY - touchStartY;
		let direction: Direction | null = null;

		if (Math.abs(deltaX) > swipeThreshold && Math.abs(deltaX) > Math.abs(deltaY)) {
			direction = deltaX > 0 ? 'right' : 'left';
		} else if (Math.abs(deltaY) > swipeThreshold && Math.abs(deltaY) > Math.abs(deltaX)) {
			direction = deltaY > 0 ? 'down' : 'up';
		}

		if (direction) {
			animateAndRecordResponse(direction);
		} else {
			cardMotion.set({ x: 0, y: 0, rotation: 0, opacity: 1 });
			cardInteracting = false;
			swipeDirection = null;
		}
	}

	function animateAndRecordResponse(direction: Direction) {
		cardInteracting = true;
		const target = {
			left: { x: -xEdge, y: 0, rotation: -20 },
			right: { x: xEdge, y: 0, rotation: 20 },
			up: { x: 0, y: -yEdge, rotation: 0 },
			down: { x: 0, y: yEdge, rotation: 0 }
		};
		if (!target[direction]) return;

		cardMotion.set({ ...target[direction], opacity: 0 }).then(() => {
			recordResponse(direction);
		});
	}

	async function recordResponse(response: string) {
		if (surveyFinished) return;
		responses = [...responses, { card: cards[currentCardIndex], response }];
		if (currentCardIndex < cards.length - 1) {
			currentCardIndex++;
			cardShown = false;
			await tick();
			cardMotion.set({ x: 0, y: 0, rotation: 0, opacity: 1 }, { instant: true });
			cardInteracting = false;
			swipeDirection = null;
			cardShown = true;
		} else {
			surveyFinished = true;
		}
	}

	function getHighlightOpacity(direction: Direction, pos: { x: number; y: number }): number {
		if (!cardInteracting || swipeDirection !== direction) return 0;
		switch (direction) {
			case 'left':
				return Math.min(maxHLOpacity, -pos.x / hlOpacityDivisor);
			case 'right':
				return Math.min(maxHLOpacity, pos.x / hlOpacityDivisor);
			case 'up':
				return Math.min(maxHLOpacity, -pos.y / hlOpacityDivisor);
			case 'down':
				return Math.min(maxHLOpacity, pos.y / hlOpacityDivisor);
			default:
				return 0;
		}
	}
</script>

<svelte:head>
	<title>Survey</title>
</svelte:head>

<div class="survey-page">
	<div
		class="highlight-overlay left"
		style="opacity: {getHighlightOpacity('left', cardMotion.current)}"
	></div>
	<div
		class="highlight-overlay right"
		style="opacity: {getHighlightOpacity('right', cardMotion.current)}"
	></div>
	<div
		class="highlight-overlay top"
		style="opacity: {getHighlightOpacity('up', cardMotion.current)}"
	></div>
	<div
		class="highlight-overlay bottom"
		style="opacity: {getHighlightOpacity('down', cardMotion.current)}"
	></div>

	<div class="card-container">
		{#if cards.length > 0}
			{#if !surveyFinished}
				{#if cardShown}
					<div
						class="card"
						style="transform: translate({cardMotion.current.x}px, {cardMotion.current
							.y}px) rotate({cardMotion.current.rotation}deg); opacity: {cardMotion.current
							.opacity};"
						on:touchstart={handleTouchStart}
						on:touchmove={handleTouchMove}
						on:touchend={handleTouchEnd}
						in:scale={{ duration: 300, start: 0.5 }}
					>
						<h1>{cards[currentCardIndex].header}</h1>
						{#if cards[currentCardIndex].p}
							<p>{cards[currentCardIndex].p}</p>
						{/if}
					</div>
				{/if}
				<div class="progress-bar">
					<div
						class="progress"
						style="width: {((currentCardIndex + 1) / cards.length) * 100}%"
					></div>
				</div>
			{:else}
				<div class="card result-card">
					<h1>Thank you!</h1>
					<p>You have completed the survey.</p>
					<h2>Your responses:</h2>
					<ul>
						{#each responses as { card, response }}
							<li><strong>{card.header}</strong>: {response}</li>
						{/each}
					</ul>
				</div>
			{/if}
		{:else}
			<div class="card">
				<h1>Loading survey...</h1>
			</div>
		{/if}
	</div>
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
	}

	.survey-page {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		overflow: hidden;
		display: flex;
		justify-content: center;
		align-items: center;
		background-color: #e0e0e0;
	}

	.card-container {
		width: 60vw;
		height: 50vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		perspective: 1000px;
	}

	.card {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background-color: white;
		border-radius: 20px;
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
		padding: 2rem;
		text-align: center;
		will-change: transform;
		cursor: grab;
		user-select: none;
		touch-action: none; /* Prevents default touch actions like scrolling */
	}

	.card.result-card {
		cursor: default;
	}

	.progress-bar {
		width: 100%;
		height: 28px;
		background-color: #e0e0e0;
		border-radius: 4px;
		overflow: hidden;
		margin-top: 2rem;
	}

	.progress {
		height: 100%;
		background-color: #4caf50;
		transition: width 0.3s ease-in-out;
	}

	h1 {
		color: #333;
		margin-bottom: 1rem;
		font-size: 1.7rem;
	}

	p {
		color: #666;
		line-height: 1.2;
		font-size: 1rem;
	}

	ul {
		list-style-type: none;
		padding: 0;
		text-align: left;
		width: 100%;
		max-width: 400px;
		margin-top: 2rem;
	}

	li {
		background-color: #f9f9f9;
		margin: 0.5rem 0;
		padding: 0.75rem;
		border-radius: 4px;
	}

	.highlight-overlay {
		position: fixed;
		width: 25%;
		height: 100%;
		top: 0;
		background: rgba(76, 175, 80, 0.5);
		transition: opacity 0.2s ease-in-out;
		pointer-events: none; /* Make sure they don't block interactions */
		z-index: 10;
	}
	.highlight-overlay.left {
		left: 0;
		background: linear-gradient(to right, rgba(255, 100, 100, 0.5), transparent);
	}
	.highlight-overlay.right {
		right: 0;
		background: linear-gradient(to left, rgba(100, 255, 100, 0.5), transparent);
	}
	.highlight-overlay.top {
		top: 0;
		left: 0;
		width: 100%;
		height: 25%;
		background: linear-gradient(to bottom, rgba(100, 100, 255, 0.5), transparent);
	}
	.highlight-overlay.bottom {
		bottom: 0;
		left: 0;
		width: 100%;
		height: 25%;
		top: auto;
		background: linear-gradient(to top, rgba(255, 255, 100, 0.5), transparent);
	}
</style>
