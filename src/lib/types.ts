export interface FormConfig {
	swipeLeftLabel: string;
	swipeRightLabel: string;
	swipeUpLabel: string;
	swipeDownLabel: string;
	questions: string[];
}

export const DEFAULT_CONFIG: FormConfig = {
	swipeLeftLabel: 'No',
	swipeRightLabel: 'Yes',
	swipeUpLabel: 'Maybe',
	swipeDownLabel: 'Skip',
	questions: []
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
