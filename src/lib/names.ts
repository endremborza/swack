const ADJECTIVES = [
	'swift', 'bold', 'calm', 'bright', 'wise', 'keen', 'brave', 'cool', 'dark', 'deep',
	'fair', 'fierce', 'free', 'glad', 'golden', 'grand', 'icy', 'jade', 'kind', 'lively',
	'merry', 'noble', 'quiet', 'radiant', 'serene', 'vivid', 'witty', 'zesty', 'eager',
	'fleet', 'gentle', 'hardy', 'humble', 'jolly', 'lucky', 'nimble', 'proud', 'rustic'
];

const NOUNS = [
	'fox', 'owl', 'hawk', 'bear', 'wolf', 'deer', 'crow', 'lynx', 'kite', 'lark',
	'panda', 'raven', 'robin', 'shark', 'stag', 'swan', 'wren', 'badger', 'falcon',
	'heron', 'jaguar', 'otter', 'penguin', 'puffin', 'walrus', 'bison', 'crane',
	'dingo', 'gecko', 'ibis', 'lemur', 'moose', 'newt', 'tapir', 'viper'
];

function pick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

export function randomName(): string {
	const adj = pick(ADJECTIVES);
	const noun = pick(NOUNS);
	return adj.charAt(0).toUpperCase() + adj.slice(1) + noun.charAt(0).toUpperCase() + noun.slice(1);
}
