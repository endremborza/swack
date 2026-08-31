import 'fake-indexeddb/auto';

// Node's built-in localStorage (inert without --localstorage-file) shadows jsdom's;
// replace it with a real in-memory Storage so code under test can use the global.
const backing = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
	configurable: true,
	value: {
		getItem: (k: string) => backing.get(k) ?? null,
		setItem: (k: string, v: string) => void backing.set(k, String(v)),
		removeItem: (k: string) => void backing.delete(k),
		clear: () => backing.clear(),
		key: (i: number) => [...backing.keys()][i] ?? null,
		get length() {
			return backing.size;
		}
	} satisfies Storage
});
