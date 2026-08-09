import type { Container } from 'injectkit';
import { vi } from 'vitest';

/**
 * A stand-in for the root container, for a singleton under test that opens a
 * scope per unit of work instead of holding a scoped service.
 *
 * Every scope resolves from the same fixed token -> instance map, so a test
 * asserts against the stubs it passed in and nothing has to model per-scope
 * caching. `createScopedContainer` and `disposeAsync` are spies because "opened
 * a scope and closed it again" is itself worth asserting: a scope that leaks is
 * a pooled connection that never goes back.
 */
export const stubContainer = (instances: [unknown, unknown][]) => {
    const registry = new Map(instances);
    const disposeAsync = vi.fn(async () => {});
    const get = vi.fn((token: unknown) => registry.get(token));
    const createScopedContainer = vi.fn(() => ({ get, disposeAsync }));

    return {
        container: { createScopedContainer } as unknown as Container,
        createScopedContainer,
        disposeAsync,
        get,
    };
};
