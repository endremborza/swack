import { SimplePool, generateSecretKey, getPublicKey, finalizeEvent, type VerifiedEvent } from 'nostr-tools';
import { encrypt as nip44Encrypt, decrypt as nip44Decrypt, getConversationKey } from 'nostr-tools/nip44';
import type { Filter } from 'nostr-tools';
import { hexToBytes, bytesToHex } from './hex';
import { getRelays, probeRelay } from './relays';

export const MIN_CONFIRMED = 3;
const CONFIG_KIND = 33333;
const AGGREGATE_KIND = 33334;
const ANSWER_KIND = 4444;

const ANSWER_PUBLISH_TIMEOUT_MS = 3000;
const CONFIG_PUBLISH_TIMEOUT_MS = 8000;
const HEALTH_INTERVAL_MS = 60_000;

export interface Keypair {
	privkeyHex: string;
	pubkey: string;
}

export interface PublishResult {
	accepted: number;
	total: number;
	relayResults: { url: string; ok: boolean }[];
}

export type RelayStatus = { url: string; ok: boolean };

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
	private allRelays: string[] = [];
	private healthTimer: ReturnType<typeof setInterval> | null = null;
	relayStatus: RelayStatus[] = [];
	onRelayStatusChange?: (status: RelayStatus[]) => void;

	async connect(waitForHealth = false): Promise<void> {
		if (this.healthTimer) clearInterval(this.healthTimer);
		this.allRelays = getRelays();
		this.relayStatus = this.allRelays.map((url) => ({ url, ok: false }));
		const healthPromise = this.runHealthCheck();
		if (waitForHealth) await healthPromise;
		else void healthPromise;
		this.healthTimer = setInterval(() => { void this.runHealthCheck(); }, HEALTH_INTERVAL_MS);
	}

	private async runHealthCheck(): Promise<void> {
		const statuses = await Promise.all(
			this.allRelays.map(async (url) => ({ url, ok: await probeRelay(url) }))
		);
		this.relayStatus = statuses;
		this.onRelayStatusChange?.(statuses);
	}

	private get activeRelays(): string[] {
		const healthy = this.relayStatus.filter((r) => r.ok).map((r) => r.url);
		return healthy.length > 0 ? healthy : this.allRelays;
	}

	private async publishToRelays(
		event: VerifiedEvent,
		relays: string[],
		timeoutMs: number,
		onRelayResult?: (url: string, ok: boolean) => void
	): Promise<PublishResult> {
		if (relays.length === 0) return { accepted: 0, total: 0, relayResults: [] };

		const publishPromises = this.pool.publish(relays, event);
		const timedPromises = publishPromises.map((p, i) => {
			const url = relays[i];
			let settled = false;
			const settle = (ok: boolean): { url: string; ok: boolean } => {
				if (!settled) {
					settled = true;
					onRelayResult?.(url, ok);
				}
				return { url, ok };
			};
			return Promise.race([
				p.then(() => settle(true)).catch(() => settle(false)),
				new Promise<{ url: string; ok: boolean }>((resolve) =>
					setTimeout(() => resolve(settle(false)), timeoutMs)
				)
			]);
		});

		const relayResults = await Promise.all(timedPromises);
		return {
			accepted: relayResults.filter((r) => r.ok).length,
			total: relays.length,
			relayResults
		};
	}

	async publishConfig(
		privkeyHex: string,
		pubkey: string,
		encryptedContent: string,
		onRelayResult?: (url: string, ok: boolean) => void
	): Promise<PublishResult> {
		const event = finalizeEvent(
			{
				kind: CONFIG_KIND,
				created_at: Math.floor(Date.now() / 1000),
				tags: [['d', pubkey]],
				content: encryptedContent
			},
			hexToBytes(privkeyHex)
		);
		return this.publishToRelays(event, this.activeRelays, CONFIG_PUBLISH_TIMEOUT_MS, onRelayResult);
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
		await this.publishToRelays(event, this.activeRelays, ANSWER_PUBLISH_TIMEOUT_MS).catch(() => {});
	}

	async publishAnswer(
		serverPubkey: string,
		payload: string,
		ephemeralPrivkeyHex: string
	): Promise<PublishResult> {
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
		return this.publishToRelays(event, this.activeRelays, ANSWER_PUBLISH_TIMEOUT_MS);
	}

	subscribeConfig(serverPubkey: string, onEvent: (encryptedContent: string) => void): () => void {
		const filter: Filter = { kinds: [CONFIG_KIND], authors: [serverPubkey] };
		const sub = this.pool.subscribeMany(this.allRelays, filter, {
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
		const sub = this.pool.subscribeMany(this.allRelays, filter, {
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
		const sub = this.pool.subscribeMany(this.allRelays, filter, {
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
		if (this.healthTimer) clearInterval(this.healthTimer);
		this.pool.destroy();
	}
}
