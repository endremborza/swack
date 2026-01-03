<script lang="ts">
	import { onMount } from 'svelte';

	let cards: { header: string; p: string | null }[] = [];
	let currentCardIndex = 0;
	let responses: { card: { header: string; p: string | null }; response: string }[] = [];
	let surveyFinished = false;

	onMount(async () => {
		const response = await fetch('/test-survey.xml');
		const xmlString = await response.text();
		const parser = new DOMParser();
		const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
		const cardElements = Array.from(xmlDoc.getElementsByTagName('card'));

		cards = cardElements.map((cardElement) => {
			const header = cardElement.querySelector('header')?.textContent ?? '';
			const p = cardElement.querySelector('p')?.textContent ?? null;
			return { header, p };
		});

		window.addEventListener('keydown', handleKeyDown);

		// Swipe handling
		let touchStartX = 0;
		let touchStartY = 0;
		let touchEndX = 0;
		let touchEndY = 0;

		const surveyEl = document.getElementById('survey-container');
		if (surveyEl) {
			surveyEl.addEventListener(
				'touchstart',
				(e) => {
					touchStartX = e.changedTouches[0].screenX;
					touchStartY = e.changedTouches[0].screenY;
				},
				{ passive: true }
			);

			surveyEl.addEventListener(
				'touchend',
				(e) => {
					touchEndX = e.changedTouches[0].screenX;
					touchEndY = e.changedTouches[0].screenY;
					handleSwipe();
				},
				{ passive: true }
			);
		}

		function handleSwipe() {
			const deltaX = touchEndX - touchStartX;
			const deltaY = touchEndY - touchStartY;

			if (Math.abs(deltaX) > Math.abs(deltaY)) {
				// Horizontal swipe
				if (deltaX > 0) {
					recordResponse('right');
				} else {
					recordResponse('left');
				}
			} else {
				// Vertical swipe
				if (deltaY > 0) {
					recordResponse('down');
				} else {
					recordResponse('up');
				}
			}
		}

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	});

	function handleKeyDown(event: KeyboardEvent) {
		switch (event.key) {
			case 'ArrowLeft':
			case 'a':
				recordResponse('left');
				break;
			case 'ArrowRight':
			case 'd':
				recordResponse('right');
				break;
			case 'ArrowUp':
			case 'w':
				recordResponse('up');
				break;
			case 'ArrowDown':
			case 's':
				recordResponse('down');
				break;
		}
	}

	function recordResponse(response: string) {
		if (surveyFinished) return;

		responses = [...responses, { card: cards[currentCardIndex], response }];

		if (currentCardIndex < cards.length - 1) {
			currentCardIndex++;
		} else {
			surveyFinished = true;
		}
	}
</script>

<svelte:head>
	<title>Survey</title>
</svelte:head>

<div id="survey-container" class="survey-container">
	{#if cards.length > 0}
		{#if !surveyFinished}
			<div class="card">
				<h1>{cards[currentCardIndex].header}</h1>
				{#if cards[currentCardIndex].p}
					<p>{cards[currentCardIndex].p}</p>
				{/if}
			</div>
			<div class="progress-bar">
				<div class="progress" style="width: {((currentCardIndex + 1) / cards.length) * 100}%"></div>
			</div>
		{:else}
			<div class="card">
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

<style>
	.survey-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 90svh;
		background-color: #f0f2f5;
		font-family: sans-serif;
		touch-action: pan-y; /* Allows vertical scroll but we handle swipes */
	}

	.card {
		background-color: white;
		border-radius: 12px;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
		padding: 2rem;
		margin: 1rem;
		width: 80%;
		max-width: 500px;
		text-align: center;
		transition: transform 0.3s ease-in-out;
	}

	.progress-bar {
		width: 80%;
		max-width: 500px;
		height: 8px;
		background-color: #e0e0e0;
		border-radius: 4px;
		overflow: hidden;
		margin-top: 1rem;
	}

	.progress {
		height: 100%;
		background-color: #4caf50;
		transition: width 0.3s ease-in-out;
	}

	h1 {
		color: #333;
		margin-bottom: 1rem;
	}

	p {
		color: #666;
		line-height: 1.6;
	}

	ul {
		list-style-type: none;
		padding: 0;
		text-align: left;
	}

	li {
		background-color: #f9f9f9;
		margin: 0.5rem 0;
		padding: 0.75rem;
		border-radius: 4px;
	}
</style>
