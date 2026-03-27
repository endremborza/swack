import { hexToBytes, bytesToHex } from './hex';

export function generateAesKey(): string {
	return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

async function importKey(keyHex: string): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', hexToBytes(keyHex), { name: 'AES-GCM' }, false, [
		'encrypt',
		'decrypt'
	]);
}

export async function encryptConfig(plaintext: string, keyHex: string): Promise<string> {
	const key = await importKey(keyHex);
	const iv = crypto.getRandomValues(new Uint8Array(12) as Uint8Array<ArrayBuffer>);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
	);
	// 24 hex chars (12 bytes) IV prefix + ciphertext
	return bytesToHex(iv) + bytesToHex(ciphertext);
}

export async function decryptConfig(encrypted: string, keyHex: string): Promise<string> {
	const key = await importKey(keyHex);
	const iv = hexToBytes(encrypted.slice(0, 24));
	const ciphertext = hexToBytes(encrypted.slice(24));
	const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
	return new TextDecoder().decode(plaintext);
}
