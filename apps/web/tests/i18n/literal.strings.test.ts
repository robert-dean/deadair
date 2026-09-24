import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { TRANSLATED } from '../../eslint.i18n.js';

// The package root, from this file rather than the working directory: the workspace's root config
// runs this suite from the repository root.
const root = resolve(import.meta.dirname, '../..');

/**
 * The literal-string lint rule, run as a test.
 *
 * `eslint.config.js` carries the rule, but the shared config turns every rule into a warning and
 * nothing in CI runs lint, so on its own it refuses nothing. This lints the console with its own
 * config and fails on the first literal that crept back.
 */
describe('the console', () => {
    it('put no literal copy in JSX', async () => {
        const results = await new ESLint({ cwd: root }).lintFiles(TRANSLATED);
        const found = results.flatMap(result =>
            result.messages
                .filter(message => message.ruleId === 'i18next/no-literal-string')
                .map(message => `${result.filePath.slice(root.length)}:${message.line} ${message.message}`),
        );
        expect(results.length).toBeGreaterThan(0);
        expect(found).toEqual([]);
        // Its own ceiling rather than the suite's 20s: this parses every translated file in the
        // console, which is seconds alone and more under a full parallel run.
    }, 120_000);
});
