import { SimplePool, generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { encrypt as nip44Encrypt, decrypt as nip44Decrypt, getConversationKey } from 'nostr-tools/nip44';
import type { Filter } from 'nostr-tools';
import { hexToBytes, bytesToHex } from './hex';
import { getRelays, probeRelay } from './relays';

const MIN_CONNECTED = 3;
const CONFIG_KIND = 33333;
const AGGREGATE_KIND = 33334;
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
	private activeRelays: string[] = [];
	relayStatus: { url: string; ok: boolean }[] = [];

	async connect(): Promise<void> {
		const relays = getRelays();
		this.relayStatus = await Promise.all(
			relays.map(async (url) => ({ url, ok: await probeRelay(url) }))
		);
		const connected = this.relayStatus.filter((r) => r.ok).map((r) => r.url);
		this.activeRelays = connected.length >= MIN_CONNECTED ? connected : relays;
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

	async publishAggregate(
		privkeyHex: string,
		pubkey: string,
		encryptedContent: string
	): Promise<void> {
		const event = finalizeEvent(
			{
				kind: AGGREGATE_KIND,
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

	subscribeAggregate(
		serverPubkey: string,
		onEvent: (encryptedContent: string) => void
	): () => void {
		const filter: Filter = { kinds: [AGGREGATE_KIND], authors: [serverPubkey] };
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
