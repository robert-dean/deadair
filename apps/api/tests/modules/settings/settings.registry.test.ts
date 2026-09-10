// The registry is a description of settings that are read somewhere else entirely, so the failure
// it can produce is disagreement: a default the console offers that the resolver does not use, or a
// choice the console offers that the parser throws away. Both look to an operator like a setting
// that does nothing, and neither is visible from either side on its own.

import { describe, expect, it } from 'vitest';

import { AIR_MODE_KEY, AIR_MODES, DEFAULT_AIR_MODE, parseAirMode } from '../../../src/modules/playout/air.mode.js';
import { MP3_BITRATES, STREAM_DEFAULTS, STREAM_KEYS, STREAM_SECRET_KEYS } from '../../../src/modules/stream/stream.settings.js';
import { SUSTAINING_KEYS } from '../../../src/modules/schedule/schedule.service.js';
import { findDescriptor, isSecretField, SETTING_DESCRIPTORS, SETTING_GROUPS } from '../../../src/modules/settings/settings.registry.js';
import {
    ANALYSIS_CONCURRENCY_KEY,
    ANALYSIS_LOCAL_PACE_KEY,
    ANALYSIS_PROVIDER_PACE_KEY,
    resolveAnalysisConcurrency,
    resolveAnalysisPaceMs,
} from '../../../src/modules/analysis/analysis.settings.js';
import { DEFAULT_SWEEP_MAX_PERCENT, resolveSweepMaxPercent, SWEEP_MAX_PERCENT_KEY } from '../../../src/modules/catalog/ingest/catalog.sweep.guard.js';
import { CHART_GENERATOR_KEYS } from '../../../src/modules/director/chart.set.generator.js';
import { SIMILAR_GENERATOR_KEYS } from '../../../src/modules/director/similar.set.generator.js';
import { ConfigFieldOptionSource } from '../../../src/modules/plugins/types/plugins.types.js';

describe('the settings registry', () => {
    it('declares every key exactly once', () => {
        const keys = SETTING_DESCRIPTORS.map(descriptor => descriptor.key);

        expect(new Set(keys).size).toBe(keys.length);
    });

    it('puts every descriptor in a group the console draws', () => {
        for (const descriptor of SETTING_DESCRIPTORS) {
            expect(SETTING_GROUPS).toContain(descriptor.group);
        }
    });

    it('leaves the sustaining source in the group the schedule page draws', () => {
        // These five are edited by `SustainingPanel`, on the schedule page, and the settings page
        // draws no card for their group. Moving one back into `rotation` would put it on both
        // pages, with two forms writing one key and only one of them beside the timetable that
        // explains it.
        for (const key of Object.values(SUSTAINING_KEYS)) {
            expect(findDescriptor(key)?.group, key).toBe('schedule');
        }
    });

    it('leaves the presenter name in the group the characters page draws', () => {
        // Edited by `PresenterNamePanel`, above the roster whose names override it. Back on the
        // station card it reads as THE presenter's name, which it is only for a host with none.
        expect(findDescriptor('station.djName')?.group).toBe('personas');
    });

    it('keeps what Icecast advertises on the stream card', () => {
        // Nothing but Icecast reads these. On the station card, beside the name, they read as the
        // station's identity and invite the question of what they do there.
        for (const key of [
            STREAM_KEYS.publicUrl,
            STREAM_KEYS.hostname,
            STREAM_KEYS.description,
            STREAM_KEYS.genre,
            STREAM_KEYS.location,
            STREAM_KEYS.language,
        ]) {
            expect(findDescriptor(key)?.group, key).toBe('stream');
        }
    });

    it('only makes a descriptor depend on a key that exists', () => {
        // A `dependsOn` naming a key nothing declares is a field the console hides forever, which
        // reads to an operator as a setting that was never built rather than as a typo.
        for (const descriptor of SETTING_DESCRIPTORS.filter(candidate => candidate.dependsOn !== undefined)) {
            expect(findDescriptor(descriptor.dependsOn!), `${descriptor.key} depends on ${descriptor.dependsOn}`).toBeDefined();
        }
    });

    it('only names a real option source in `optionsFrom`', () => {
        // A descriptor's `optionsFrom` is resolved by the console against a closed vocabulary
        // (`ConfigFieldOptionSource`). A typo here is a field that silently offers no suggestions,
        // because the console has nothing keyed under the name it actually declared.
        for (const descriptor of SETTING_DESCRIPTORS.filter(candidate => candidate.optionsFrom !== undefined)) {
            expect(ConfigFieldOptionSource.options, descriptor.key).toContain(descriptor.optionsFrom);
        }
    });

    it('never gives a secret a default', () => {
        // A default for a secret would be a shared password shipped in the source, and the console
        // would prefill an input that must always start empty.
        for (const descriptor of SETTING_DESCRIPTORS.filter(isSecretField)) {
            expect(descriptor.default).toBeUndefined();
        }
    });

    it('describes every stream secret as a secret', () => {
        // The stream module decides which keys hold ciphertext. A key it encrypts and this
        // declares as a `string` would be rendered in the console, in a text input, as base64.
        for (const key of STREAM_SECRET_KEYS) {
            expect(isSecretField(findDescriptor(key)!)).toBe(true);
        }
    });

    it('offers the air modes the parser actually accepts', () => {
        // A `select` offering a value `parseAirMode` does not recognise would write a row the
        // station silently ignores, falling back while the console shows the choice as made.
        const descriptor = findDescriptor(AIR_MODE_KEY)!;
        const offered = (descriptor.options ?? []).map(option => option.value);

        expect(offered).toEqual([...AIR_MODES]);
        for (const value of offered) {
            expect(parseAirMode(value)).toBe(value);
        }
    });

    it('offers the same defaults the resolvers fall back to', () => {
        // The whole reason `STREAM_DEFAULTS` and `DEFAULT_AIR_MODE` are named constants rather
        // than literals in two files.
        expect(findDescriptor(AIR_MODE_KEY)!.default).toBe(DEFAULT_AIR_MODE);
        expect(findDescriptor(STREAM_KEYS.title)!.default).toBe(STREAM_DEFAULTS.title);
        expect(findDescriptor(STREAM_KEYS.mount)!.default).toBe(STREAM_DEFAULTS.mount);
    });

    it('declares the range its own resolver clamps to', () => {
        // Same failure as the defaults above, one field along: a console that accepts a figure the
        // resolver then clamps away shows the operator a number the walk is not running on. The
        // ends are checked by asking the resolver, rather than by comparing to the constants, so
        // this fails if either side moves.
        const descriptor = findDescriptor(ANALYSIS_CONCURRENCY_KEY)!;

        expect(resolveAnalysisConcurrency(descriptor.min)).toBe(descriptor.min);
        expect(resolveAnalysisConcurrency(descriptor.max)).toBe(descriptor.max);
        expect(resolveAnalysisConcurrency(descriptor.max! + 1)).toBe(descriptor.max);
        expect(resolveAnalysisConcurrency(descriptor.min! - 1)).toBe(descriptor.min);
    });

    it('declares the sweep guard over the same range and default its resolver uses', () => {
        // The same disagreement again, and here it has teeth in one direction
        // specifically: a console that accepts 200 against a resolver that clamps
        // to 100 shows an operator a guard they think they turned off.
        const descriptor = findDescriptor(SWEEP_MAX_PERCENT_KEY)!;

        expect(descriptor.default).toBe(DEFAULT_SWEEP_MAX_PERCENT);
        expect(resolveSweepMaxPercent(descriptor.min)).toBe(descriptor.min);
        expect(resolveSweepMaxPercent(descriptor.max)).toBe(descriptor.max);
        expect(resolveSweepMaxPercent(descriptor.max! + 1)).toBe(descriptor.max);
        expect(resolveSweepMaxPercent(descriptor.min! - 1)).toBe(descriptor.min);
    });

    it('bounds both analysis pauses at the ceiling the resolver enforces', () => {
        // A pace is clamped rather than rejected downstream for the same reason concurrency is, so
        // the same disagreement is available: a console taking a day-long pause between tracks and
        // a walk quietly using ten minutes.
        for (const key of [ANALYSIS_PROVIDER_PACE_KEY, ANALYSIS_LOCAL_PACE_KEY]) {
            const descriptor = findDescriptor(key)!;

            expect(descriptor.min, key).toBe(0);
            expect(resolveAnalysisPaceMs(descriptor.max, 0), key).toBe(descriptor.max);
            expect(resolveAnalysisPaceMs(descriptor.max! + 1, 0), key).toBe(descriptor.max);
        }
    });

    it('asks for each control on a type that has one', () => {
        // A `control` the form has no branch for is a field silently drawn as whatever it would
        // have been, which reads from the registry as though the better control had been applied.
        for (const descriptor of SETTING_DESCRIPTORS.filter(candidate => candidate.control !== undefined)) {
            expect(descriptor.control === 'slider' ? 'number' : 'string', descriptor.key).toBe(descriptor.type);
        }
    });

    it('gives a number a numeric default, so the console does not draw an empty box', () => {
        // `parseSetting` answers an unstored key with the descriptor's default VERBATIM, and the
        // form only prefills a number field from a number — so a numeric setting defaulted to the
        // string '8000' draws blank on a station that has never set one, which reads as unset. The
        // live example was the Icecast port, which was a `string` field holding a number.
        for (const descriptor of SETTING_DESCRIPTORS.filter(candidate => candidate.type === 'number' && candidate.default !== undefined)) {
            expect(typeof descriptor.default, descriptor.key).toBe('number');
        }
    });

    it('gives every slider the two ends one cannot be drawn without', () => {
        // A slider with an open end has no track, so the console falls back to a spinner and the
        // setting silently keeps the control it was meant to stop having. Nothing about that is
        // visible from the registry side, which is why it is asserted here rather than trusted.
        for (const descriptor of SETTING_DESCRIPTORS.filter(candidate => candidate.control === 'slider')) {
            expect(descriptor.type, descriptor.key).toBe('number');
            expect(descriptor.min, descriptor.key).toBeDefined();
            expect(descriptor.max, descriptor.key).toBeDefined();
            expect(descriptor.min!, descriptor.key).toBeLessThan(descriptor.max!);
        }
    });

    it('bounds both mixes at the share their generators clamp to', () => {
        // The disagreement the ranges above exist to stop, in the one place it was live: both
        // mixes are a share between 0 and 1, both generators hold their own `readMix` clamping to
        // that, and neither descriptor declared it — so the route took 5 and the hour ran at 1.
        // Compared against literals rather than against a resolver because `readMix` is private to
        // each generator and duplicated between them; the number that must not move is the 1.
        for (const key of [CHART_GENERATOR_KEYS.mix, SIMILAR_GENERATOR_KEYS.mix]) {
            const descriptor = findDescriptor(key)!;

            expect(descriptor.min, key).toBe(0);
            expect(descriptor.max, key).toBe(1);
            // Without this the console would ask for a share as a percentage-shaped slider and
            // store 40 where every reader multiplies by a fraction.
            expect(descriptor.unit, key).toBe('fraction');
        }
    });

    it('pairs each range with a field that can actually be its other end', () => {
        // A `rangeWith` the console cannot resolve is not a crash, it is two boxes again — so the
        // pair silently goes back to being invertible, which is the whole thing this was for. Every
        // way that can happen is checked here, because none of them is visible from the form.
        for (const lower of SETTING_DESCRIPTORS.filter(candidate => candidate.rangeWith !== undefined)) {
            const upper = findDescriptor(lower.rangeWith!);

            expect(upper, `${lower.key} ranges with ${lower.rangeWith}`).toBeDefined();
            expect(upper!.type, upper!.key).toBe('number');
            // Drawn by one form, and the settings page draws one per group: paired across two of
            // them, each end would fall back to its own control on a different card.
            expect(upper!.group, upper!.key).toBe(lower.group);
            // One track carries both handles, so a pair that disagreed about its ends would draw
            // one of them somewhere it is not allowed to be and have the route refuse it on save.
            expect(upper!.min, upper!.key).toBe(lower.min);
            expect(upper!.max, upper!.key).toBe(lower.max);
            expect(upper!.step, upper!.key).toBe(lower.step);
            expect(lower.min, lower.key).toBeDefined();
            expect(lower.max, lower.key).toBeDefined();
            // The far end is never drawn on its own, so a `dependsOn` on it would be a condition
            // nothing evaluates and a `rangeWith` would be a chain the form does not follow.
            expect(upper!.rangeWith, upper!.key).toBeUndefined();
            expect(upper!.dependsOn, upper!.key).toBeUndefined();
        }
    });

    it('leaves the far end of every range a setting the route can still refuse by name', () => {
        // The far end has no box, which makes its label easy to write as "The other end". It is
        // what `serializeSetting` puts in the message when it rejects one, and a 422 reading
        // `"The other end" cannot be higher than 8` names nothing an operator can act on.
        for (const lower of SETTING_DESCRIPTORS.filter(candidate => candidate.rangeWith !== undefined)) {
            expect(findDescriptor(lower.rangeWith!)!.label, lower.rangeWith).not.toMatch(/^The other end/);
        }
    });

    it('only offers choices on a field that can hold one of them', () => {
        // `options` on a `string` is a suggestion list and on a `select` it is the whole
        // vocabulary; on a `boolean` or a `number` it is nothing at all, drawn by no branch of the
        // form. Same for `optionsFrom`, which is the same list arriving by a different route.
        const offering = SETTING_DESCRIPTORS.filter(candidate => candidate.options !== undefined || candidate.optionsFrom !== undefined);

        for (const descriptor of offering) {
            expect(['string', 'url', 'select', 'multiselect'], descriptor.key).toContain(descriptor.type);
        }
    });

    it('leaves the MP3 bitrate open where the other two are closed', () => {
        // The distinction is `radio.liq`'s, not the console's: `%mp3(bitrate=…)` takes an
        // `int_of_string`, so any figure typed is honoured and the list is a suggestion — while
        // `%opus` and `%fdkaac` want a literal at parse time, which is why those two are a `select`
        // and a value off their list would be a setting the stream cannot keep.
        const mp3 = findDescriptor(STREAM_KEYS.bitrate)!;

        expect(mp3.type).toBe('string');
        expect((mp3.options ?? []).map(option => option.value)).toEqual([...MP3_BITRATES]);
        expect(findDescriptor(STREAM_KEYS.opusBitrate)!.type).toBe('select');
        expect(findDescriptor(STREAM_KEYS.aacBitrate)!.type).toBe('select');
    });

    it('does not know about a key nobody declared', () => {
        // Undeclared rows are ordinary — a setting arrives before its console does — and the point
        // is that this answers `undefined` rather than inventing a descriptor for one. The four
        // mixer knobs are the live example: constants in `stream.service.ts` today, and deferred
        // in `docs/todo/mixer-settings-in-db.md` until something can restart Liquidsoap.
        expect(findDescriptor('stream.duckGainDb')).toBeUndefined();
    });
});
