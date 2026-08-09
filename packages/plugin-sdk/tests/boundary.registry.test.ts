import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BOUNDARY_LIVE_OBJECT_TYPES, BOUNDARY_METHOD_TYPES, JSON_SAFE_PAYLOAD_TYPES } from '../src/boundary.json.safe.js';

/**
 * The compile-time guard in `src/boundary.json.safe.ts` is exhaustive over the
 * FIELDS of every type it lists, but the list itself is hand-maintained. This
 * closes that last hole: add an exported interface to a boundary source file
 * and forget to classify it, and this fails.
 *
 * The check is a source scan rather than a type-level trick because
 * TypeScript cannot enumerate a module's exported types. It is deliberately
 * dumb: a regex over `export interface`, which is the only form the boundary
 * files use.
 */
const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

/** Every source file whose exported interfaces cross the plugin boundary. */
const BOUNDARY_SOURCE_FILES = [
    'plugin.host.ts',
    'plugin.lifecycle.ts',
    'plugin.manifest.ts',
    'plugin.permissions.ts',
    'plugin.streams.ts',
    'plugin.config.fields.ts',
    'capabilities/music.provider.ts',
    'capabilities/enrichment.ts',
    'capabilities/speech.ts',
] as const;

function exportedInterfacesIn(relativePath: string): string[] {
    const source = readFileSync(resolve(srcDir, relativePath), 'utf8');
    return [...source.matchAll(/^export interface (\w+)/gm)].map(match => match[1] as string);
}

const declared = BOUNDARY_SOURCE_FILES.flatMap(file => exportedInterfacesIn(file).map(name => [file, name] as const));

const registered = new Set<string>([...JSON_SAFE_PAYLOAD_TYPES, ...BOUNDARY_METHOD_TYPES, ...BOUNDARY_LIVE_OBJECT_TYPES]);

describe('boundary type registry coverage', () => {
    it('finds the boundary interfaces at all (guards against a broken scan)', () => {
        expect(declared.length).toBeGreaterThan(20);
    });

    it.each(declared)('%s exports %s, which is classified in the registry', (_file, name) => {
        expect(
            registered.has(name),
            `"${name}" crosses the plugin boundary but is in none of the three registries in ` +
                `src/boundary.json.safe.ts. If it is a data payload, add it to both JSON_SAFE_PAYLOAD_TYPES ` +
                `and AssertAllBoundaryPayloadsAreJsonSafe. If it describes methods, add it to ` +
                `BOUNDARY_METHOD_TYPES. If it deliberately carries a live object, add it to ` +
                `BOUNDARY_LIVE_OBJECT_TYPES and say in a comment which field and why.`,
        ).toBe(true);
    });

    it('has no stale entries: every registered name still exists in the source', () => {
        const declaredNames = new Set(declared.map(([, name]) => name));
        const stale = [...registered].filter(name => !declaredNames.has(name));
        expect(stale, `registered but no longer exported from a boundary source file: ${stale.join(', ')}`).toEqual([]);
    });

    it('classifies each name exactly once', () => {
        const counts = new Map<string, number>();
        for (const name of [...JSON_SAFE_PAYLOAD_TYPES, ...BOUNDARY_METHOD_TYPES, ...BOUNDARY_LIVE_OBJECT_TYPES]) {
            counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        const duplicated = [...counts].filter(([, count]) => count > 1).map(([name]) => name);
        expect(duplicated, `classified in more than one registry: ${duplicated.join(', ')}`).toEqual([]);
    });
});
