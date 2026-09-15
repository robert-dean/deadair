import type { KeyFace } from '../../src/actions/key.face.js';

/** A key that records what it was told, in order, as short strings a test can compare. */
export interface FakeKey extends KeyFace {
    calls: string[];
}

export function fakeKey(id: string): FakeKey {
    const calls: string[] = [];
    return {
        id,
        calls,
        setTitle: async title => void calls.push(`title ${title ?? ''}`),
        setImage: async image => void calls.push(`image ${image ?? ''}`),
        setState: async state => void calls.push(`state ${state}`),
        showOk: async () => void calls.push('ok'),
        showAlert: async () => void calls.push('alert'),
    };
}
