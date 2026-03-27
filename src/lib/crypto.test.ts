import { describe, it, expect } from 'vitest';
import { generateAesKey, encryptConfig, decryptConfig } from './crypto';

describe('generateAesKey', () => {
	it('returns 32 hex chars (16 bytes)', () => {
		const key = generateAesKey();
		expect(key).toHaveLength(32);
		expect(key).toMatch(/^[0-9a-f]+$/);
	});

	it('returns unique keys each call', () => {
		expect(generateAesKey()).not.toBe(generateAesKey());
	});
});

describe('encryptConfig / decryptConfig', () => {
	it('round-trips plaintext', async () => {
		const key = generateAesKey();
		const plaintext = JSON.stringify({ questions: ['Q1', 'Q2'], swipeLeftLabel: 'No' });
		const encrypted = await encryptConfig(plaintext, key);
		const decrypted = await decryptConfig(encrypted, key);
		expect(decrypted).toBe(plaintext);
	});

	it('produces different ciphertext each call (random IV)', async () => {
		const key = generateAesKey();
		const plaintext = 'hello';
		const a = await encryptConfig(plaintext, key);
		const b = await encryptConfig(plaintext, key);
		expect(a).not.toBe(b);
	});

	it('throws on wrong key', async () => {
		const key = generateAesKey();
		const wrongKey = generateAesKey();
		const encrypted = await encryptConfig('secret', key);
		await expect(decryptConfig(encrypted, wrongKey)).rejects.toThrow();
	});

	it('throws on truncated ciphertext', async () => {
		const key = generateAesKey();
		const encrypted = await encryptConfig('secret', key);
		await expect(decryptConfig(encrypted.slice(0, 10), key)).rejects.toThrow();
	});
});
