const STORAGE_KEY = 'swack_relays';

export const DEFAULT_RELAYS: readonly string[] = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.primal.net',
	'wss://relay.snort.social',
	'wss://nostr.mom',
	'wss://nostr.lu.ke',
	'wss://relay.nostr.band',
	'wss://offchain.pub',
	'wss://nostr.wine',
	'wss://nostr-pub.wellorder.net',
	'wss://relay.oxtr.dev',
	'wss://relayable.org'
];

export function getRelays(): string[] {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			const parsed = JSON.parse(stored);
			if (Array.isArray(parsed) && parsed.length > 0) return parsed as string[];
		}
	} catch {
		// ignore
	}
	return [...DEFAULT_RELAYS];
}

export function setRelays(urls: string[]): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(urls));
}

export function resetRelays(): void {
	localStorage.removeItem(STORAGE_KEY);
}

export async function probeRelay(url: string, timeoutMs = 5000): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		try {
			const ws = new WebSocket(url);
			const timer = setTimeout(() => {
				ws.close();
				resolve(false);
			}, timeoutMs);
			ws.onopen = () => {
				clearTimeout(timer);
				ws.close();
				resolve(true);
			};
			ws.onerror = () => {
				clearTimeout(timer);
				resolve(false);
			};
		} catch {
			resolve(false);
		}
	});
}
