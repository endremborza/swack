export interface FormConfig {
	swipeLeftLabel: string;
	swipeRightLabel: string;
	swipeUpLabel: string;
	swipeDownLabel: string;
	questions: string[];
	aggregateVisibility: 'admin-only' | 'on-completion';
}

export const DEFAULT_CONFIG: FormConfig = {
	swipeLeftLabel: '-1',
	swipeRightLabel: '+1',
	swipeUpLabel: 'skip',
	swipeDownLabel: '',
	questions: [],
	aggregateVisibility: 'admin-only'
};

export type SwipeDirection = 'Left' | 'Right' | 'Up' | 'Down';

export interface SwipeAnswer {
	sessionId: string;
	name: string;
	qIndex: number;
	answer: SwipeDirection;
	timestamp: number;
}

export interface AdminRecord {
	pubkey: string;
	privkeyHex: string;
	configAesKey: string;
}

export interface AnswerRecord {
	eventId: string;
	formPubkey: string;
	sessionId: string;
	name: string;
	qIndex: number;
	answer: string;
	timestamp: number;
}

export interface AggregateRow {
	question: string;
	score: number;
	votes: number;
}
