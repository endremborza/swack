<script lang="ts">
	import { generateKeypair } from '$lib/nostr';
	import { generateAesKey } from '$lib/crypto';
	import { saveAdmin, getAllAdmins } from '$lib/store';
	import { onMount } from 'svelte';
	import type { AdminRecord } from '$lib/types';

	let existing: AdminRecord[] = $state([]);
	let creating = $state(false);

	onMount(async () => {
		existing = await getAllAdmins();
	});

	async function createForm() {
		creating = true;
		const { privkeyHex, pubkey } = generateKeypair();
		const configAesKey = generateAesKey();
		await saveAdmin({ pubkey, privkeyHex, configAesKey });
		window.location.href = `/admin#${pubkey}`;
	}
</script>

<svelte:head>
	<title>Swack — decentralized swipe surveys</title>
</svelte:head>

<div class="page">
	<header>
		<span class="logo">Swack</span>
		<span class="tagline">decentralized swipe surveys</span>
	</header>

	<main>
		<section class="hero">
			<h1>Collect feedback with a swipe</h1>
			<p>
				Swack is a serverless, zero-cost survey tool. Questions are published to the Nostr network
				and answers are end-to-end encrypted — no server, no database, no account required. Your
				keys live in your browser.
			</p>
			<button class="primary create-btn" onclick={createForm} disabled={creating}>
				{creating ? 'Creating…' : 'Create a new form'}
			</button>
		</section>

		<section class="how">
			<h2>How it works</h2>
			<div class="steps">
				<div class="step">
					<span class="num">1</span>
					<div>
						<strong>Create a form</strong>
						<p>
							A Nostr keypair is generated in your browser. The private key never leaves this
							device.
						</p>
					</div>
				</div>
				<div class="step">
					<span class="num">2</span>
					<div>
						<strong>Add questions and configure labels</strong>
						<p>
							Write your questions and set the swipe direction labels. The config is AES-encrypted
							before being published so only link holders can read it.
						</p>
					</div>
				</div>
				<div class="step">
					<span class="num">3</span>
					<div>
						<strong>Share the link</strong>
						<p>
							The shareable link embeds the form's public key and the config decryption key. Anyone
							with it can fill out the survey.
						</p>
					</div>
				</div>
				<div class="step">
					<span class="num">4</span>
					<div>
						<strong>Answers arrive encrypted</strong>
						<p>
							Each response is NIP-44 encrypted and published to the Nostr relay pool. Only your
							admin view can decrypt them.
						</p>
					</div>
				</div>
			</div>
		</section>

		{#if existing.length > 0}
			<section class="existing">
				<h2>Your forms</h2>
				<ul>
					{#each existing as form}
						<li>
							<a href={`/admin#${form.pubkey}`}>
								<span class="pubkey">{form.pubkey.slice(0, 16)}…</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</main>

	<footer>
		<p>Powered by <a href="https://nostr.com" target="_blank" rel="noopener">Nostr</a>. No tracking. No accounts.</p>
	</footer>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}

	header {
		padding: 1rem 2rem;
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}

	.logo {
		font-size: 1.4rem;
		font-weight: 700;
		letter-spacing: -0.5px;
		color: var(--accent);
	}

	.tagline {
		font-size: 0.8125rem;
		color: var(--text-muted);
	}

	main {
		max-width: 680px;
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
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0 0 1.5rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-size: 0.75rem;
	}

	.hero p {
		font-size: 1.05rem;
		color: var(--text-muted);
		max-width: 560px;
		margin: 0 0 2rem;
		line-height: 1.7;
	}

	.create-btn {
		font-size: 1rem;
		padding: 0.75rem 1.75rem;
	}

	.create-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.steps {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.step {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
	}

	.num {
		flex-shrink: 0;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		background: var(--surface2);
		border: 1px solid var(--border);
		color: var(--text-muted);
		font-size: 0.8125rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-top: 0.1rem;
	}

	.step strong {
		display: block;
		margin-bottom: 0.2rem;
	}

	.step p {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.9rem;
		line-height: 1.6;
	}

	.existing ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.existing li {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.75rem 1rem;
	}

	.pubkey {
		font-family: ui-monospace, monospace;
		font-size: 0.875rem;
	}

	footer {
		padding: 1.25rem 2rem;
		text-align: center;
		font-size: 0.8125rem;
		color: var(--text-muted);
		border-top: 1px solid var(--border);
	}

	footer p {
		margin: 0;
	}
</style>
