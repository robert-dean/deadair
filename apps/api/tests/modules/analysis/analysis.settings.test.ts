// Analysis has exactly one analyzer, and the reason is stronger than the one speech has. Two
// voices rendering a break is two breaks; two analyzers measuring a record is two claims about one
// physical fact, and the answer to a disagreement is to pick one rather than to average them.
//
// The failure here is also quieter than speech's, which is why `explainNoAnalyzer` exists at all: a
// station talking in the wrong voice is obvious within one break, where a station whose records were
// measured by an analyzer nobody chose looks exactly like one measured by the right one.

import { describe, expect, it } from 'vitest';

import {
    ANALYSIS_PLUGIN_KEY,
    DEFAULT_ANALYSIS_CONCURRENCY,
    MAX_ANALYSIS_CONCURRENCY,
    explainNoAnalyzer,
    resolveAnalysisConcurrency,
    selectAnalysisPlugin,
} from '../../../src/modules/analysis/analysis.settings.js';
import type { AnalysisPlugin } from '../../../src/modules/plugins/plugin.capabilities.js';

const plugin = (id: string): AnalysisPlugin => ({ record: { id } }) as unknown as AnalysisPlugin;

const bundled = plugin('deadair.analyzer');
const other = plugin('deadair.someone-elses-analyzer');

describe('selectAnalysisPlugin', () => {
    it('picks the only candidate when nobody has chosen', () => {
        expect(selectAnalysisPlugin([bundled], undefined)).toBe(bundled);
        expect(selectAnalysisPlugin([bundled], '')).toBe(bundled);
        expect(selectAnalysisPlugin([bundled], '   ')).toBe(bundled);
    });

    it('picks the one that was named', () => {
        expect(selectAnalysisPlugin([bundled, other], 'deadair.someone-elses-analyzer')).toBe(other);
    });

    it('refuses to guess between several when nobody has chosen', () => {
        expect(selectAnalysisPlugin([bundled, other], undefined)).toBeUndefined();
    });

    it('does not fall back when the named plugin is not running', () => {
        // Measuring with a different analyzer than the one named produces rows that look right and
        // are not, and nothing about them says so. `analyzer_plugin_id` on the row exists for the
        // same reason this refuses.
        expect(selectAnalysisPlugin([bundled], 'deadair.someone-elses-analyzer')).toBeUndefined();
    });

    it('answers nothing when nothing can measure', () => {
        // An ordinary state, not a fault: every track still plays, unmeasured.
        expect(selectAnalysisPlugin([], undefined)).toBeUndefined();
        expect(selectAnalysisPlugin([], 'deadair.analyzer')).toBeUndefined();
    });
});

describe('explainNoAnalyzer', () => {
    it('tells the three failures apart, because the operator does something different about each', () => {
        expect(explainNoAnalyzer([], undefined)).toMatch(/install and enable/);
        expect(explainNoAnalyzer([bundled, other], undefined)).toMatch(new RegExp(`set ${ANALYSIS_PLUGIN_KEY}`));
        expect(explainNoAnalyzer([bundled], 'deadair.someone-elses-analyzer')).toMatch(/names "deadair\.someone-elses-analyzer"/);
    });

    it('names the candidates when the operator has to choose between them', () => {
        expect(explainNoAnalyzer([bundled, other], undefined)).toContain('deadair.analyzer, deadair.someone-elses-analyzer');
    });
});

describe('resolveAnalysisConcurrency', () => {
    it('defaults to one, so nobody has their machine taken over by a background walk', () => {
        expect(resolveAnalysisConcurrency(undefined)).toBe(DEFAULT_ANALYSIS_CONCURRENCY);
        expect(resolveAnalysisConcurrency(null)).toBe(DEFAULT_ANALYSIS_CONCURRENCY);
        expect(resolveAnalysisConcurrency('')).toBe(DEFAULT_ANALYSIS_CONCURRENCY);
        expect(resolveAnalysisConcurrency('not a number')).toBe(DEFAULT_ANALYSIS_CONCURRENCY);
    });

    it('takes a number however the settings layer spelled it', () => {
        // The value arrives from a jsonb column via a live config view, so it is legitimately
        // either by the time it gets here.
        expect(resolveAnalysisConcurrency(4)).toBe(4);
        expect(resolveAnalysisConcurrency('4')).toBe(4);
    });

    it('clamps rather than rejecting, because a refused setting stops the walk entirely', () => {
        expect(resolveAnalysisConcurrency(0)).toBe(1);
        expect(resolveAnalysisConcurrency(-7)).toBe(1);
        expect(resolveAnalysisConcurrency(4000)).toBe(MAX_ANALYSIS_CONCURRENCY);
    });

    it('floors a fraction rather than opening a partial connection', () => {
        expect(resolveAnalysisConcurrency(2.9)).toBe(2);
    });
});
