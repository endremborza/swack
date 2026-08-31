import { describe, expect, it } from 'vitest';
import {
	loadProgress,
	mergeServerAnswers,
	newProgress,
	reconcileProgress,
	remainingOf,
	saveProgress
} from './progress';

describe('progress', () => {
	it('creates a full permutation order', () => {
		const p = newProgress(10, true, 'A', 0);
		expect([...p.order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it('round-trips through localStorage', () => {
		const p = newProgress(3, false, 'A', 0);
		p.answers.push({ qIndex: 0, answer: 'Right', confirmed: false });
		saveProgress('t', p);
		const loaded = loadProgress('t');
		expect(loaded?.sessionId).toBe(p.sessionId);
		expect(loaded?.answers).toHaveLength(1);
	});

	it('remaining excludes answered, keeps order', () => {
		const p = newProgress(4, false, 'A', 0);
		p.answers.push({ qIndex: 1, answer: 'Left', confirmed: true });
		expect(remainingOf(p)).toEqual([0, 2, 3]);
	});

	it('reconcile keeps a valid progress untouched', () => {
		const p = newProgress(5, true, 'A', 0);
		expect(reconcileProgress(p, 5, true)).toBe(p);
	});

	it('reconcile drops out-of-range answers and covers new questions', () => {
		const p = newProgress(3, false, 'A', 0);
		p.answers.push({ qIndex: 2, answer: 'Right', confirmed: true });
		const grown = reconcileProgress(p, 5, false);
		expect([...grown.order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
		const shrunk = reconcileProgress(p, 2, false);
		expect(shrunk.answers).toHaveLength(0);
		expect([...shrunk.order].sort((a, b) => a - b)).toEqual([0, 1]);
	});

	it('merge marks server-known answers confirmed and adds missing ones', () => {
		const p = newProgress(4, false, 'A', 0);
		p.answers.push({ qIndex: 0, answer: 'Left', confirmed: false });
		mergeServerAnswers(p, [
			{ qIndex: 0, answer: 'Left' },
			{ qIndex: 3, answer: 'Right' }
		]);
		expect(p.answers.find((a) => a.qIndex === 0)?.confirmed).toBe(true);
		expect(p.answers.find((a) => a.qIndex === 3)?.confirmed).toBe(true);
		expect(remainingOf(p)).toEqual([1, 2]);
	});
});
