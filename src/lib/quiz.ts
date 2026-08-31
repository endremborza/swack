import type { DirectionLabels, SwipeDirection } from './types';

export interface QuizPublicConfig {
	slug: string;
	name: string;
	questions: string[];
	labels: DirectionLabels;
	randomizeOrder: boolean;
	nameMode: 'disabled' | 'required';
	namePrefill: boolean;
	namePrompt: string;
	feedback: 'none' | 'instant' | 'final' | 'both';
	leaderboard: { visibility: 'none' | 'done' | 'always' };
	generation: number;
}

export interface AnswerAck {
	ok: boolean;
	duplicate: boolean;
	correct?: boolean;
}

export interface SessionState {
	answered: { qIndex: number; answer: SwipeDirection }[];
	name: string | null;
	score?: number;
}

export interface LeaderboardEntry {
	name: string;
	points?: number;
}

const API_BASE: string = import.meta.env.VITE_QUIZ_API ?? '/api';
const TIMEOUT_MS = 8000;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		...init,
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error(body?.error ?? `request failed (${res.status})`);
	}
	return res.json();
}

export function getQuizConfig(slug: string): Promise<QuizPublicConfig> {
	return api(`/quiz/${slug}`);
}

export function getSession(slug: string, sessionId: string): Promise<SessionState> {
	return api(`/quiz/${slug}/session/${sessionId}`);
}

export function postAnswer(
	slug: string,
	body: {
		sessionId: string;
		qIndex: number;
		answer: SwipeDirection;
		name: string;
		timestamp: number;
		generation: number;
	}
): Promise<AnswerAck> {
	return api(`/quiz/${slug}/answer`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

export function getLeaderboard(slug: string): Promise<{ entries: LeaderboardEntry[] }> {
	return api(`/quiz/${slug}/leaderboard`);
}
