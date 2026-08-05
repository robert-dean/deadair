import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '@deadair/plugin-sdk';

import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord, PluginStatus } from '../../../src/modules/plugins/types/plugin.record.js';

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
        id: 'test.plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        kind: 'music-provider',
        capabilities: ['catalog'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
        ...overrides,
    };
}

function record(overrides: Partial<PluginRecord> = {}): PluginRecord {
    return {
        id: 'test.plugin',
        dir: '/plugins/test-plugin',
        status: 'discovered',
        ...overrides,
    };
}

describe('PluginRegistry', () => {
    describe('list', () => {
        it('returns every record, insertion ordered, when no filter is given', () => {
            const registry = new PluginRegistry();
            const a = record({ id: 'a', manifest: manifest({ id: 'a', kind: 'music-provider' }) });
            const b = record({ id: 'b', manifest: manifest({ id: 'b', kind: 'enrichment' }) });
            registry.setAll([a, b]);

            expect(registry.list()).toEqual([a, b]);
        });

        it('filters to records whose manifest kind matches', () => {
            const registry = new PluginRegistry();
            const provider = record({ id: 'a', manifest: manifest({ id: 'a', kind: 'music-provider' }) });
            const enrichment = record({ id: 'b', manifest: manifest({ id: 'b', kind: 'enrichment' }) });
            registry.setAll([provider, enrichment]);

            expect(registry.list({ kind: 'enrichment' })).toEqual([enrichment]);
        });

        it('excludes a failed candidate with no manifest from any kind filter', () => {
            const registry = new PluginRegistry();
            const failed = record({ id: 'a', status: 'failed', error: 'boom', manifest: undefined });
            registry.setAll([failed]);

            expect(registry.list({ kind: 'music-provider' })).toEqual([]);
        });
    });

    describe('get and instance', () => {
        it('returns undefined from get for an unknown id', () => {
            const registry = new PluginRegistry();
            expect(registry.get('nope')).toBeUndefined();
        });

        it('returns undefined from instance for an unknown id', () => {
            const registry = new PluginRegistry();
            expect(registry.instance('nope')).toBeUndefined();
        });

        it('returns undefined from instance for a known id with no live instance', () => {
            const registry = new PluginRegistry();
            registry.upsert(record({ id: 'a', status: 'discovered' }));

            expect(registry.get('a')).toBeDefined();
            expect(registry.instance('a')).toBeUndefined();
        });

        it('returns the live instance once a record carries one', () => {
            const registry = new PluginRegistry();
            const instance = { init: async () => {} };
            registry.upsert(record({ id: 'a', status: 'active', instance }));

            expect(registry.instance('a')).toBe(instance);
        });
    });

    describe('setStatus', () => {
        it('moves a record from discovered to active to failed, observable in list()', () => {
            const registry = new PluginRegistry();
            registry.upsert(record({ id: 'a', status: 'discovered' }));

            registry.setStatus('a', 'active');
            expect(registry.get('a')?.status).toBe('active');

            registry.setStatus('a', 'failed', 'init threw');
            expect(registry.list()).toEqual([expect.objectContaining({ id: 'a', status: 'failed', error: 'init threw' })]);
        });

        it('clears a previous error when moving to a status with no error argument', () => {
            const registry = new PluginRegistry();
            registry.upsert(record({ id: 'a', status: 'failed', error: 'boom' }));

            registry.setStatus('a', 'discovered');

            expect(registry.get('a')?.error).toBeUndefined();
        });

        it('is a no-op for an unknown id', () => {
            const registry = new PluginRegistry();
            registry.setStatus('nope', 'active');

            expect(registry.get('nope')).toBeUndefined();
        });
    });

    describe('setAll and duplicate ids', () => {
        it('keeps the first record on a duplicate id and drops the rest', () => {
            const registry = new PluginRegistry();
            const first = record({ id: 'a', dir: '/first' });
            const second = record({ id: 'a', dir: '/second' });
            registry.setAll([first, second]);

            expect(registry.list()).toEqual([first]);
        });
    });

    describe('remove', () => {
        it('drops a known record and reports true', () => {
            const registry = new PluginRegistry();
            registry.upsert(record({ id: 'a' }));

            expect(registry.remove('a')).toBe(true);
            expect(registry.get('a')).toBeUndefined();
        });

        it('reports false for an id with no record', () => {
            const registry = new PluginRegistry();
            expect(registry.remove('nope')).toBe(false);
        });
    });
});
