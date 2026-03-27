import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AdminRecord, AnswerRecord } from './types';

interface SwackDB extends DBSchema {
	admins: {
		key: string;
		value: AdminRecord;
	};
	answers: {
		key: string;
		value: AnswerRecord;
		indexes: { 'by-form': string };
	};
}

let db: IDBPDatabase<SwackDB> | null = null;

export async function getDb(): Promise<IDBPDatabase<SwackDB>> {
	if (db) return db;
	db = await openDB<SwackDB>('swack', 1, {
		upgrade(d) {
			d.createObjectStore('admins', { keyPath: 'pubkey' });
			const answers = d.createObjectStore('answers', { keyPath: 'eventId' });
			answers.createIndex('by-form', 'formPubkey');
		}
	});
	return db;
}

export function resetDb(): void {
	db = null;
}

export async function saveAdmin(record: AdminRecord): Promise<void> {
	await (await getDb()).put('admins', record);
}

export async function getAdmin(pubkey: string): Promise<AdminRecord | undefined> {
	return (await getDb()).get('admins', pubkey);
}

export async function getAllAdmins(): Promise<AdminRecord[]> {
	return (await getDb()).getAll('admins');
}

export async function saveAnswer(record: AnswerRecord): Promise<void> {
	await (await getDb()).put('answers', record);
}

export async function getAnswersForForm(formPubkey: string): Promise<AnswerRecord[]> {
	return (await getDb()).getAllFromIndex('answers', 'by-form', formPubkey);
}
