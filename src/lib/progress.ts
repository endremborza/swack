import type { SwipeDirection } from './types';

export interface ProgressAnswer {
	qIndex: number;
	answer: SwipeDirection;
	confirmed: boolean;
}

export interface QuizProgress {
	sessionId: string;
	name: string;
	generation: number;
	order: number[];
	answers: ProgressAnswer[];
	done: boolean;
	startedAt: number;
	updatedAt: number;
}

const key = (slug: string) => `swack_quiz_${slug}`;

export function shuffled(arr: number[]): number[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

export function newProgress(
	questionCount: number,
	randomize: boolean,
	name: string,
	generation: number
): QuizProgress {
	const indices = Array.from({ length: questionCount }, (_, i) => i);
	return {
		sessionId: crypto.randomUUID(),
		name,
		generation,
		order: randomize ? shuffled(indices) : indices,
		answers: [],
		done: false,
		startedAt: Date.now(),
		updatedAt: Date.now()
	};
}

export function loadProgress(slug: string): QuizProgress | null {
	const raw = localStorage.getItem(key(slug));
	if (!raw) return null;
	try {
		const p = JSON.parse(raw) as QuizProgress;
		if (!p.sessionId || !Array.isArray(p.order) || !Array.isArray(p.answers)) return null;
		return p;
	} catch {
		return null;
	}
}

export function saveProgress(slug: string, p: QuizProgress): void {
	p.updatedAt = Date.now();
	localStorage.setItem(key(slug), JSON.stringify(p));
}

export function clearProgress(slug: string): void {
	localStorage.removeItem(key(slug));
}

/** Question indices still to answer, in display order. */
export function remainingOf(p: QuizProgress): number[] {
	const answered = new Set(p.answers.map((a) => a.qIndex));
	return p.order.filter((q) => !answered.has(q));
}

/** Rebuild a progress against the current question count: answers out of range are
 * dropped, the order is rebuilt to cover exactly the current questions. */
export function reconcileProgress(
	p: QuizProgress,
	questionCount: number,
	randomize: boolean
): QuizProgress {
	const inRange = (q: number) => Number.isInteger(q) && q >= 0 && q < questionCount;
	const orderValid =
		p.order.length === questionCount &&
		p.order.every(inRange) &&
		new Set(p.order).size === questionCount;
	const answers = p.answers.filter((a) => inRange(a.qIndex));
	if (orderValid && answers.length === p.answers.length) return p;
	const kept = new Set(p.order.filter(inRange));
	const missing = Array.from({ length: questionCount }, (_, i) => i).filter((q) => !kept.has(q));
	return {
		...p,
		answers,
		order: [...p.order.filter(inRange), ...(randomize ? shuffled(missing) : missing)]
	};
}

/** Fold the server's answered set into local progress: the server is the
 * authority on what is recorded, local answers it has are marked confirmed. */
export function mergeServerAnswers(
	p: QuizProgress,
	server: { qIndex: number; answer: SwipeDirection }[]
): QuizProgress {
	const local = new Map(p.answers.map((a) => [a.qIndex, a]));
	for (const s of server) {
		const mine = local.get(s.qIndex);
		if (mine) {
			mine.answer = s.answer;
			mine.confirmed = true;
		} else {
			p.answers.push({ qIndex: s.qIndex, answer: s.answer, confirmed: true });
		}
	}
	return p;
}
