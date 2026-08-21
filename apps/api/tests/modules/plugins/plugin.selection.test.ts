// The rule three capabilities share for picking the ONE plugin that will do a job. It lives in one
// place because the failure when speech, the model and the analyzer disagree about it is a station
// that behaves differently depending on which subsystem is asking — so this file is where the rule
// is pinned, and each capability's own test only checks its wording.

import { beforeEach, describe, expect, it } from 'vitest';

import {
    byPluginId,
    defaultPickIsNews,
    explainDefaultPick,
    explainNoPlugin,
    pickedByDefault,
    pluginsWith,
    resetDefaultPickReports,
    selectPlugin,
    type CapabilityWording,
} from '../../../src/modules/plugins/plugin.selection.js';

const plugin = (id: string) => ({ record: { id } });

const first = plugin('acme.first');
const second = plugin('zeta.second');

const WORDING: CapabilityWording = { key: 'render.speechPluginId', can: 'speak', remedy: 'install and enable a TTS plugin' };

beforeEach(() => resetDefaultPickReports());

describe('selectPlugin', () => {
    it('picks the only candidate when nobody has chosen', () => {
        // Every station with one plugin installed, and it means nobody has to choose before the
        // thing will work. Blank and whitespace are the same as unset, because that is what an
        // emptied settings box leaves behind.
        expect(selectPlugin([first], undefined)).toBe(first);
        expect(selectPlugin([first], '')).toBe(first);
        expect(selectPlugin([first], '   ')).toBe(first);
    });

    it('takes the first when nobody has chosen between several', () => {
        // The rule that changed. It answered `undefined` here, on the argument that a pick the
        // operator did not make looks deliberate — but for speech the cost of refusing is silence,
        // and the station degrades rather than stops everywhere else it has the choice.
        expect(selectPlugin([first, second], undefined)).toBe(first);
    });

    it('takes the FIRST, which is why callers sort', () => {
        // "First" is only a stable answer because every caller passes `byPluginId` order.
        // Installation order is whatever the disk scan found and is not a thing an operator chose.
        expect(selectPlugin([second, first], undefined)).toBe(second);
        expect(selectPlugin([second, first].sort(byPluginId), undefined)).toBe(first);
    });

    it('picks the one that was named', () => {
        expect(selectPlugin([first, second], 'zeta.second')).toBe(second);
    });

    it('does not fall back when the named plugin is not running', () => {
        // The rule that did NOT change, and the whole difference between a default and an
        // instruction: the setting names what the station is supposed to use, and quietly using a
        // different one because that one is disabled is how a station ends up wrong with nothing in
        // the log to explain it.
        expect(selectPlugin([first], 'zeta.second')).toBeUndefined();
        expect(selectPlugin([], 'acme.first')).toBeUndefined();
    });

    it('answers nothing when nothing can do the job', () => {
        expect(selectPlugin([], undefined)).toBeUndefined();
    });
});

describe('pickedByDefault', () => {
    it('is true only when the station had a choice and made none', () => {
        expect(pickedByDefault([first, second], undefined)).toBe(true);
        expect(pickedByDefault([first, second], '')).toBe(true);
    });

    it('is false for a single candidate, which is not a decision anybody needs telling about', () => {
        expect(pickedByDefault([first], undefined)).toBe(false);
        expect(pickedByDefault([], undefined)).toBe(false);
    });

    it('is false when the operator chose', () => {
        expect(pickedByDefault([first, second], 'acme.first')).toBe(false);
    });
});

describe('explainNoPlugin', () => {
    it('tells the two failures apart, because the operator does something different about each', () => {
        expect(explainNoPlugin([], undefined, WORDING)).toContain('install and enable a TTS plugin');
        expect(explainNoPlugin([first], 'zeta.second', WORDING)).toContain('names "zeta.second"');
    });

    it('no longer has a sentence for several-and-none-chosen, because that is not a failure', () => {
        // It used to. That branch became `explainDefaultPick`, where it reads as a note rather than
        // as something to go and fix.
        expect(explainNoPlugin([first, second], undefined, WORDING)).toBe(explainNoPlugin([], undefined, WORDING));
    });
});

describe('explainDefaultPick', () => {
    it('names what was chosen and what it was chosen over', () => {
        // The operator's next move is to set the key, so the sentence has to carry what to set it
        // to as well as what happened.
        const said = explainDefaultPick(first, [first, second], WORDING);

        expect(said).toContain('"acme.first"');
        expect(said).toContain('zeta.second');
        expect(said).toContain('render.speechPluginId is unset');
    });
});

describe('defaultPickIsNews', () => {
    it('is news once, and then is not', () => {
        // A caller asks on every render and every commit pass. Saying it once is the whole bargain
        // that lets an unset key pick rather than refuse; saying it every time would be a line per
        // track boundary for as long as the key stays unset.
        expect(defaultPickIsNews(first, [first, second], WORDING.key)).toBe(true);
        expect(defaultPickIsNews(first, [first, second], WORDING.key)).toBe(false);
    });

    it('is news again when the answer changes', () => {
        // An install, an uninstall, or the operator finally choosing are all worth reporting, and
        // all three change either the pick or the field of candidates.
        expect(defaultPickIsNews(first, [first, second], WORDING.key)).toBe(true);
        expect(defaultPickIsNews(first, [first, second, plugin('mid.third')], WORDING.key)).toBe(true);
        expect(defaultPickIsNews(second, [first, second, plugin('mid.third')], WORDING.key)).toBe(true);
    });

    it('says nothing about a single candidate', () => {
        expect(defaultPickIsNews(first, [first], WORDING.key)).toBe(false);
    });

    it('keeps the three capabilities apart', () => {
        // Keyed by the SETTING, since that is what identifies the capability. Sharing one slot
        // would mean the analyzer's pick silenced the report of the model's.
        expect(defaultPickIsNews(first, [first, second], 'render.speechPluginId')).toBe(true);
        expect(defaultPickIsNews(first, [first, second], 'llm.pluginId')).toBe(true);
        expect(defaultPickIsNews(first, [first, second], 'analysis.pluginId')).toBe(true);
    });
});

describe('pluginsWith', () => {
    it('skips a record the capability view declines, and an undefined one', () => {
        // The `undefined` entries are why this takes records rather than the registry: a sync asked
        // to run one plugin passes `[registry.get(id)]` and an unknown id is skipped here.
        const records = [{ id: 'a' }, undefined, { id: 'b' }];
        const found = pluginsWith(records as never, record => ((record as { id: string }).id === 'a' ? plugin('a') : undefined));

        expect(found.map(entry => entry.record.id)).toEqual(['a']);
    });
});
