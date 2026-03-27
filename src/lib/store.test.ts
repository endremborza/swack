import { describe, it, expect, beforeEach } from 'vitest';
import { saveAdmin, getAdmin, getAllAdmins, saveAnswer, getAnswersForForm, resetDb } from './store';
import type { AdminRecord, AnswerRecord } from './types';

beforeEach(() => {
	resetDb();
});

const adminA: AdminRecord = {
	pubkey: 'aabbcc',
	privkeyHex: '112233',
	configAesKey: 'deadbeef'
};

const adminB: AdminRecord = {
	pubkey: 'ddeeff',
	privkeyHex: '445566',
	configAesKey: 'cafebabe'
};

describe('admin records', () => {
	it('saves and retrieves an admin record', async () => {
		await saveAdmin(adminA);
		expect(await getAdmin(adminA.pubkey)).toEqual(adminA);
	});

	it('returns undefined for unknown pubkey', async () => {
		expect(await getAdmin('nonexistent')).toBeUndefined();
	});

	it('overwrites on duplicate pubkey', async () => {
		await saveAdmin(adminA);
		const updated = { ...adminA, configAesKey: 'newkey' };
		await saveAdmin(updated);
		expect(await getAdmin(adminA.pubkey)).toEqual(updated);
	});

	it('getAllAdmins returns all records', async () => {
		await saveAdmin(adminA);
		await saveAdmin(adminB);
		const all = await getAllAdmins();
		expect(all).toHaveLength(2);
		expect(all.map((r) => r.pubkey)).toContain(adminA.pubkey);
		expect(all.map((r) => r.pubkey)).toContain(adminB.pubkey);
	});
});

const answer = (eventId: string, qIndex: number, formPubkey = adminA.pubkey): AnswerRecord => ({
	eventId,
	formPubkey,
	sessionId: 'sess1',
	name: 'TestUser',
	qIndex,
	answer: 'Right',
	timestamp: Date.now()
});

describe('answer records', () => {
	it('saves and retrieves answers by form', async () => {
		await saveAnswer(answer('ev1', 0));
		await saveAnswer(answer('ev2', 1));
		const results = await getAnswersForForm(adminA.pubkey);
		expect(results).toHaveLength(2);
	});

	it('does not return answers from other forms', async () => {
		await saveAnswer(answer('ev1', 0, adminA.pubkey));
		await saveAnswer(answer('ev2', 0, adminB.pubkey));
		expect(await getAnswersForForm(adminA.pubkey)).toHaveLength(1);
		expect(await getAnswersForForm(adminB.pubkey)).toHaveLength(1);
	});

	it('deduplicates by eventId', async () => {
		const rec = answer('ev1', 0);
		await saveAnswer(rec);
		await saveAnswer(rec);
		expect(await getAnswersForForm(adminA.pubkey)).toHaveLength(1);
	});
});
