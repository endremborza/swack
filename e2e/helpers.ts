import { generateSecretKey, getPublicKey, finalizeEvent, type VerifiedEvent } from 'nostr-tools';
import type { Page } from '@playwright/test';

export const MOCK_RELAY = 'wss://mock-relay.test';
const CONFIG_KIND = 33333;

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
	const arr = new Uint8Array(hex.length / 2);
	for (let i = 0; i < arr.length; i++) {
		arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return arr;
}

async function encryptConfig(plaintext: string, keyHex: string): Promise<string> {
	const key = await globalThis.crypto.subtle.importKey(
		'raw',
		hexToBytes(keyHex),
		{ name: 'AES-GCM' },
		false,
		['encrypt']
	);
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = new Uint8Array(
		await globalThis.crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv },
			key,
			new TextEncoder().encode(plaintext)
		)
	);
	return bytesToHex(iv) + bytesToHex(ciphertext);
}

export interface TestForm {
	pubkey: string;
	configAesKey: string;
	configEvent: VerifiedEvent;
}

export async function createTestForm(
	questions: string[],
	opts: {
		name?: string;
		swipeLeftLabel?: string;
		swipeRightLabel?: string;
		swipeUpLabel?: string;
		swipeDownLabel?: string;
		nameMode?: 'disabled' | 'required';
	} = {}
): Promise<TestForm> {
	const privkey = generateSecretKey();
	const pubkey = getPublicKey(privkey);
	const configAesKey = bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));

	const config = {
		name: opts.name ?? 'Test Survey',
		swipeLeftLabel: opts.swipeLeftLabel ?? '-1',
		swipeRightLabel: opts.swipeRightLabel ?? '+1',
		swipeUpLabel: opts.swipeUpLabel ?? 'skip',
		swipeDownLabel: opts.swipeDownLabel ?? '',
		questions,
		aggregateVisibility: 'admin-only',
		randomizeOrder: false,
		confirmThreshold: 2,
		nameMode: opts.nameMode ?? 'disabled',
	};

	const encryptedContent = await encryptConfig(JSON.stringify(config), configAesKey);
	const configEvent = finalizeEvent(
		{
			kind: CONFIG_KIND,
			created_at: Math.floor(Date.now() / 1000),
			tags: [['d', pubkey]],
			content: encryptedContent,
		},
		privkey
	);

	return { pubkey, configAesKey, configEvent };
}

/**
 * Sets localStorage to use the mock relay and routes WebSocket connections to it.
 * Must be called before page.goto().
 */
export async function useMockRelay(page: Page, configEvent?: VerifiedEvent): Promise<void> {
	await page.addInitScript((relay) => {
		localStorage.setItem('swack_relays', JSON.stringify([relay]));
	}, MOCK_RELAY);

	await page.routeWebSocket(MOCK_RELAY, (ws) => {
		ws.onMessage((data) => {
			const raw = typeof data === 'string' ? data : data.toString('utf8');
			const msg = JSON.parse(raw) as unknown[];
			if (msg[0] === 'REQ') {
				const subId = msg[1] as string;
				const filter = msg[2] as { kinds?: number[] };
				if (configEvent && filter?.kinds?.includes(CONFIG_KIND)) {
					ws.send(JSON.stringify(['EVENT', subId, configEvent]));
				}
				ws.send(JSON.stringify(['EOSE', subId]));
			} else if (msg[0] === 'EVENT') {
				const event = msg[1] as { id: string };
				ws.send(JSON.stringify(['OK', event.id, true, '']));
			}
		});
	});
}
