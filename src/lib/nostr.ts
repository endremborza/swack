import { SimplePool, generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { encrypt as nip44Encrypt, decrypt as nip44Decrypt, getConversationKey } from 'nostr-tools/nip44';
import type { Filter } from 'nostr-tools';
import { hexToBytes, bytesToHex } from './hex';

export const RELAYS = [
	"wss://relay.damus.io",       // Backed by the Damus iOS client
	"wss://nos.lol",              // Historically very stable 
	"wss://relay.primal.net",     // Backed by the Primal client (Extremely fast/scalable)
	"wss://relay.snort.social",   // Backed by the Snort web client
	"wss://nostr.mom",            // Reliable community relay
	"wss://nostr.lu.ke",          // High-uptime community relay
	"wss://relay.nostr.band"      // Nostr.band search index (Can be strict on rate-limits, but good for redundancy)
];

export const RELAYS_BAK: string[] = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.nostr.band',
	'wss://offchain.pub',
	'wss://relay.snort.social',
	'wss://nostr.wine',
	'wss://relay.primal.net',
	'wss://nostr.bitcoiner.social',
	'wss://relay.current.fyi',
	'wss://purplepag.es',
	'wss://nostr-pub.wellorder.net',
	'wss://relay.oxtr.dev',
	'wss://atlas.nostr.land',
	'wss://relayable.org',
	'wss://relay.nostr.bg'
];

const MIN_CONNECTED = 3;
const CONFIG_KIND = 33333;
const ANSWER_KIND = 4444;

export interface Keypair {
	privkeyHex: string;
	pubkey: string;
}

export function generateKeypair(): Keypair {
	const privkey = generateSecretKey();
	return { privkeyHex: bytesToHex(privkey), pubkey: getPublicKey(privkey) };
}

export function encryptAnswer(
	ephemeralPrivkeyHex: string,
	serverPubkey: string,
	payload: string
): string {
	const convKey = getConversationKey(hexToBytes(ephemeralPrivkeyHex), serverPubkey);
	return nip44Encrypt(payload, convKey);
}

export function decryptAnswer(
	serverPrivkeyHex: string,
	senderPubkey: string,
	ciphertext: string
): string {
	const convKey = getConversationKey(hexToBytes(serverPrivkeyHex), senderPubkey);
	return nip44Decrypt(ciphertext, convKey);
}

export class NostrPool {
	private pool = new SimplePool();
	private activeRelays: string[] = RELAYS;

	async connect(): Promise<void> {
		const results = await Promise.allSettled(
			RELAYS.map(
				(url) =>
					new Promise<string>((resolve, reject) => {
						const ws = new WebSocket(url);
						const t = setTimeout(() => {
							ws.close();
							reject();
						}, 5000);
						ws.onopen = () => {
							clearTimeout(t);
							ws.close();
							resolve(url);
						};
						ws.onerror = () => {
							clearTimeout(t);
							reject();
						};
					})
			)
		);

		const connected = results
			.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
			.map((r) => r.value);

		this.activeRelays = connected.length >= MIN_CONNECTED ? connected : RELAYS;
	}

	async publishConfig(privkeyHex: string, pubkey: string, encryptedContent: string): Promise<void> {
		const event = finalizeEvent(
			{
				kind: CONFIG_KIND,
				created_at: Math.floor(Date.now() / 1000),
				tags: [['d', pubkey]],
				content: encryptedContent
			},
			hexToBytes(privkeyHex)
		);
		await Promise.any(this.pool.publish(this.activeRelays, event));
	}

	async publishAnswer(
		serverPubkey: string,
		payload: string,
		ephemeralPrivkeyHex: string
	): Promise<void> {
		const encrypted = encryptAnswer(ephemeralPrivkeyHex, serverPubkey, payload);
		const event = finalizeEvent(
			{
				kind: ANSWER_KIND,
				created_at: Math.floor(Date.now() / 1000),
				tags: [['p', serverPubkey]],
				content: encrypted
			},
			hexToBytes(ephemeralPrivkeyHex)
		);
		await Promise.any(this.pool.publish(this.activeRelays, event));
	}

	subscribeConfig(serverPubkey: string, onEvent: (encryptedContent: string) => void): () => void {
		const filter: Filter = { kinds: [CONFIG_KIND], authors: [serverPubkey] };
		const sub = this.pool.subscribeMany(this.activeRelays, filter, {
			onevent(event) {
				onEvent(event.content);
			}
		});
		return () => sub.close();
	}

	subscribeAnswers(
		serverPubkey: string,
		serverPrivkeyHex: string,
		onAnswer: (payload: string, eventId: string, senderPubkey: string) => void
	): () => void {
		const filter: Filter = { kinds: [ANSWER_KIND], '#p': [serverPubkey] };
		const sub = this.pool.subscribeMany(this.activeRelays, filter, {
			onevent(event) {
				try {
					const payload = decryptAnswer(serverPrivkeyHex, event.pubkey, event.content);
					onAnswer(payload, event.id, event.pubkey);
				} catch {
					// malformed or unrelated event
				}
			}
		});
		return () => sub.close();
	}

	destroy(): void {
		this.pool.destroy();
	}
}
