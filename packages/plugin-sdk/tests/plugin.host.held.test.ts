import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * A guard on the bundled plugins rather than on the SDK: no `Plugin` method reads `this.host` after
 * its first `await`.
 *
 * The SDK's CLAUDE.md explains why. A config save reinitialises a plugin while a request may still
 * be in flight, `this.host` then throws, and an ordinary failure becomes an invoker fault (three of
 * which quarantine the plugin). The rule was written down after websearch hit it, and a later sweep
 * still found it in twenty-nine methods across ten plugins, so it is checked here rather than
 * remembered.
 *
 * What it can see: a direct `this.host` read in a method of a class that extends `Plugin`, after the
 * first `await` in that method's own body. What it cannot: a synchronous helper that reads
 * `this.host` and is called after an await (chatterbox's `resolveVoice` was one, and now takes the
 * host instead), and classes that hold a host they were handed, which are not affected. `onLoad` and
 * `onUnload` are left out: `onUnload` runs before `dispose` releases the host, and `onLoad` reading
 * config and secrets in turn is how every plugin starts, outside the in-flight case this is about.
 */
const PLUGINS = join(import.meta.dirname, '../../../plugins');
const EXEMPT = new Set(['onLoad', 'onUnload']);

function sources(): string[] {
    return readdirSync(PLUGINS, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .flatMap(entry => {
            const src = join(PLUGINS, entry.name, 'src');
            try {
                return readdirSync(src, { recursive: true, encoding: 'utf8' })
                    .filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'))
                    .map(file => join(src, file));
            } catch {
                return [];
            }
        });
}

const extendsPlugin = (node: ts.ClassDeclaration): boolean =>
    node.heritageClauses?.some(
        clause => clause.token === ts.SyntaxKind.ExtendsKeyword && clause.types.some(type => type.expression.getText() === 'Plugin'),
    ) ?? false;

/** Where the first `await` in a body ends, not counting the bodies of functions nested inside it. */
function firstAwaitEnd(body: ts.Node): number | undefined {
    let end: number | undefined;
    const visit = (node: ts.Node): void => {
        if (ts.isAwaitExpression(node) && (end === undefined || node.getEnd() < end)) end = node.getEnd();
        if (!ts.isFunctionLike(node)) ts.forEachChild(node, visit);
    };
    ts.forEachChild(body, visit);
    return end;
}

const isHostRead = (node: ts.Node): node is ts.PropertyAccessExpression =>
    ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword && node.name.text === 'host';

/** Every `file:line method` that reads `this.host` after awaiting. */
function lateHostReads(file: string): string[] {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const found: string[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isClassDeclaration(node) && extendsPlugin(node)) {
            for (const member of node.members) {
                if (!ts.isMethodDeclaration(member) || member.body === undefined || EXEMPT.has(member.name.getText())) continue;

                const awaited = firstAwaitEnd(member.body);
                if (awaited === undefined) continue;

                const reads = (child: ts.Node): void => {
                    if (isHostRead(child) && child.getStart() > awaited) {
                        const line = source.getLineAndCharacterOfPosition(child.getStart()).line + 1;
                        found.push(`${relative(PLUGINS, file)}:${line} ${member.name.getText()}`);
                    }
                    ts.forEachChild(child, reads);
                };
                reads(member.body);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);

    return found;
}

describe('the bundled plugins', () => {
    it('hold the host before their first await rather than reading this.host after it', () => {
        const files = sources();

        expect(files.length).toBeGreaterThan(0);
        expect(files.flatMap(lateHostReads)).toEqual([]);
    });

    it('would see a late read if one were written', () => {
        const probe = join(import.meta.dirname, 'plugin.host.held.probe.ts');
        expect(lateHostReads(probe)).toEqual(['../packages/plugin-sdk/tests/plugin.host.held.probe.ts:9 speak']);
    });
});
