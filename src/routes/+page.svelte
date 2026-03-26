<script lang="ts">
	let gasUrl = $state('');
	let generatedLink = $state('');
	let copied = $state(false);

	const TEMPLATE_ID = '1spFq8dt0VtroDPalmOQ4-9aJA6AsbVmoFvBG9zykBDY';

	const TEMPLATE_URL = `https://docs.google.com/spreadsheets/d/${TEMPLATE_ID}/copy`;

	function generateLink() {
		const trimmed = gasUrl.trim();
		if (!trimmed) return;
		generatedLink = `${window.location.origin}/fill#${btoa(trimmed)}`;
	}

	async function copyLink() {
		await navigator.clipboard.writeText(generatedLink);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<svelte:head>
	<title>Swack — Zero-cost swipe surveys</title>
</svelte:head>

<div class="page">
	<header>
		<span class="logo">Swack</span>
		<span class="tagline">zero-cost swipe surveys</span>
	</header>

	<main>
		<section class="hero">
			<h1>Collect feedback with a swipe</h1>
			<p>
				Swack turns a Google Sheet into a Tinder-style survey. No server, no database, no cost —
				your data lives in a spreadsheet you own.
			</p>
		</section>

		<section class="steps">
			<h2>How to set up your form</h2>

			<div class="step">
				<span class="step-num">1</span>
				<div>
					<strong>Clone the template sheet</strong>
					<p>
						This creates a Google Sheet with the right structure and a pre-written Apps Script
						backend.
					</p>
					<a class="btn btn-secondary" href={TEMPLATE_URL} target="_blank" rel="noopener">
						Get the template
					</a>
				</div>
			</div>

			<div class="step">
				<span class="step-num">2</span>
				<div>
					<strong>Fill in your questions and configure labels</strong>
					<p>
						Add questions to the <code>Questions</code> tab. Edit the <code>Config</code> tab to set your
						form title and the label for each swipe direction (leave blank to disable a direction).
					</p>
				</div>
			</div>

			<div class="step">
				<span class="step-num">3</span>
				<div>
					<strong>Deploy the Apps Script</strong>
					<p>
						Open <strong>Extensions → Apps Script</strong> in your sheet, click
						<strong>Deploy → New deployment</strong>, choose <em>Web app</em>, set
						<em>Execute as: Me</em> and <em>Who has access: Anyone</em>. Copy the Web App URL.
					</p>
				</div>
			</div>

			<div class="step">
				<span class="step-num">4</span>
				<div>
					<strong>Generate your shareable link</strong>
					<p>Paste the Web App URL below to create a link you can share with respondents.</p>
				</div>
			</div>
		</section>

		<section class="generator">
			<h2>Generate a form link</h2>
			<div class="input-row">
				<input
					bind:value={gasUrl}
					type="url"
					placeholder="https://script.google.com/macros/s/…/exec"
					onkeydown={(e) => e.key === 'Enter' && generateLink()}
				/>
				<button class="btn btn-primary" onclick={generateLink} disabled={!gasUrl.trim()}>
					Generate
				</button>
			</div>

			{#if generatedLink}
				<div class="result">
					<span class="result-url">{generatedLink}</span>
					<button class="btn btn-copy" onclick={copyLink}>
						{copied ? 'Copied!' : 'Copy'}
					</button>
				</div>
				<p class="hint">Share this link with anyone you want to fill out your form.</p>
			{/if}
		</section>
	</main>

	<footer>
		<p>Responses are stored in your Google Sheet. You own your data.</p>
	</footer>
</div>

<style>
	.page {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background: #f8fafc;
	}

	header {
		padding: 1.25rem 2rem;
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		border-bottom: 1px solid #e2e8f0;
		background: white;
	}

	.logo {
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: -0.5px;
		color: #2563eb;
	}

	.tagline {
		font-size: 0.875rem;
		color: #64748b;
	}

	main {
		max-width: 720px;
		margin: 0 auto;
		padding: 3rem 1.5rem 4rem;
		flex: 1;
		width: 100%;
	}

	section {
		margin-bottom: 3.5rem;
	}

	h1 {
		font-size: 2rem;
		font-weight: 700;
		line-height: 1.2;
		margin: 0 0 1rem;
	}

	h2 {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0 0 1.5rem;
		color: #334155;
	}

	.hero p {
		font-size: 1.1rem;
		color: #475569;
		max-width: 560px;
		margin: 0;
	}

	.steps {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.step {
		display: flex;
		gap: 1.25rem;
		align-items: flex-start;
	}

	.step-num {
		flex-shrink: 0;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: #2563eb;
		color: white;
		font-weight: 700;
		font-size: 0.875rem;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-top: 0.1rem;
	}

	.step strong {
		display: block;
		margin-bottom: 0.25rem;
	}

	.step p {
		margin: 0 0 0.75rem;
		color: #475569;
		font-size: 0.9375rem;
	}

	code {
		background: #f1f5f9;
		border-radius: 4px;
		padding: 0.1em 0.4em;
		font-size: 0.875em;
		font-family: ui-monospace, 'Cascadia Code', monospace;
	}

	.generator {
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 12px;
		padding: 2rem;
	}

	.input-row {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	input[type='url'] {
		flex: 1;
		min-width: 0;
		padding: 0.625rem 0.875rem;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		font-size: 0.9375rem;
		color: #0f172a;
		background: #f8fafc;
		outline: none;
		transition: border-color 0.15s;
	}

	input[type='url']:focus {
		border-color: #2563eb;
		background: white;
	}

	.btn {
		padding: 0.625rem 1.25rem;
		border-radius: 8px;
		font-size: 0.9375rem;
		font-weight: 500;
		cursor: pointer;
		border: none;
		transition:
			background 0.15s,
			opacity 0.15s;
		white-space: nowrap;
	}

	.btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.btn-primary {
		background: #2563eb;
		color: white;
	}

	.btn-primary:hover:not(:disabled) {
		background: #1d4ed8;
	}

	.btn-secondary {
		background: #f1f5f9;
		color: #334155;
		border: 1px solid #e2e8f0;
		display: inline-block;
		text-decoration: none;
	}

	.btn-secondary:hover {
		background: #e2e8f0;
	}

	.result {
		margin-top: 1.25rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: #f1f5f9;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		flex-wrap: wrap;
	}

	.result-url {
		flex: 1;
		min-width: 0;
		font-family: ui-monospace, 'Cascadia Code', monospace;
		font-size: 0.8125rem;
		color: #334155;
		word-break: break-all;
	}

	.btn-copy {
		background: #0f172a;
		color: white;
		padding: 0.375rem 0.875rem;
		font-size: 0.875rem;
	}

	.btn-copy:hover {
		background: #1e293b;
	}

	.hint {
		margin: 0.75rem 0 0;
		font-size: 0.875rem;
		color: #64748b;
	}

	footer {
		padding: 1.5rem 2rem;
		text-align: center;
		font-size: 0.875rem;
		color: #94a3b8;
		border-top: 1px solid #e2e8f0;
	}

	footer p {
		margin: 0;
	}

	@media (max-width: 480px) {
		h1 {
			font-size: 1.5rem;
		}

		.input-row {
			flex-direction: column;
		}

		.btn {
			width: 100%;
		}
	}
</style>
