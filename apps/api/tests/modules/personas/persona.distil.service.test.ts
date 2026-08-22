// The distil pass, which is the one thing on this station that writes something an operator has to
// look at. So most of these are about what it does NOT do: it declines five different ways without
// touching a notebook, it never puts an unverifiable inference straight into use, and it never moves
// a watermark past a window it has not read.
//
// The config double hands over STRINGS, deliberately and per the settings gotcha in CLAUDE.md: every
// layer of `AppConfig` holds text, so a double coercing to a real boolean would pass whether or not
// the switch is read through `settingIsOn` — which is exactly how `model.set.generator.test.ts` hid
// a live bug for as long as it existed.

import { describe, expect, it, vi } from 'vitest';

import { PersonaDistilService, PERSONA_NOTES_KEYS } from '../../../src/modules/personas/persona.distil.service.js';
import { MIN_SCRIPTS } from '../../../src/modules/personas/persona.notes.model.js';
import type { Persona } from '../../../src/modules/personas/persona.js';

const persona = (over: Partial<Persona> = {}): Persona => ({
    id: 'p1',
    key: 'pirate',
    label: 'Pirate captain',
    style: 'a pirate captain who runs a radio station',
    active: true,
    ...over,
});

/**
 * Enough breaks to be worth reading, all of them quoting the same line so a quote check can pass.
 *
 * `at` is a STRING here because that is what the repository actually hands over — the column's own
 * text, at microsecond precision, because Luxon is millisecond-resolution and a watermark that went
 * through a `DateTime` compares as earlier than the row it was taken from and re-reads it forever.
 * A double that handed over a `DateTime` would pass either way, which is the trap `CLAUDE.md`
 * records against a config double that coerced its own values.
 */
const scripts = (count = MIN_SCRIPTS) =>
    Array.from({ length: count }, (_, index) => ({
        id: `s${index}`,
        script: `Steady on, shipmate. Booker T. and the boys are the tightest band alive. Break ${index}.`,
        at: `2026-08-2${index % 9} 12:00:00.${String(index).padStart(6, '0')}+00`,
    }));

/** Values as `deadair.settings` actually holds them. See the file note. */
const config = (values: Record<string, string> = {}) => ({
    get: vi.fn((key: string, fallback: unknown) => values[key] ?? fallback),
});

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

interface HarnessOptions {
    enabled?: string;
    canGenerate?: boolean;
    said?: ReturnType<typeof scripts>;
    /** What the distil call answers with, in order. The verification calls follow. */
    answers?: string[];
}

function harness(options: HarnessOptions = {}) {
    const personas = { list: vi.fn(async () => [persona()]) };
    const notes = {
        readThrough: vi.fn(async () => undefined),
        markRead: vi.fn(async () => {}),
        addAll: vi.fn(async (writes: unknown[]) => writes.length),
    };
    const history = { writtenBy: vi.fn(async () => options.said ?? scripts()) };

    const answers = [...(options.answers ?? [])];
    const llm = {
        canGenerate: vi.fn(() => options.canGenerate ?? true),
        explainGenerator: vi.fn(() => 'no plugin'),
        converse: vi.fn(async () => ({ text: answers.shift() ?? 'yes', finishReason: 'stop' })),
    };
    const activity = { record: vi.fn(async () => {}) };
    const log = logger();

    const service = new PersonaDistilService(
        personas as never,
        notes as never,
        history as never,
        llm as never,
        activity as never,
        config({ [PERSONA_NOTES_KEYS.enabled]: options.enabled ?? 'true' }) as never,
        log as never,
    );

    return { service, personas, notes, history, llm, activity, logger: log };
}

const noted = (entries: { kind: string; note: string; quote: string }[]) => JSON.stringify({ notes: entries });

const QUOTE = 'the tightest band alive';

describe('PersonaDistilService', () => {
    // The switch is a STRING in the table, and `config.get(key, false)` answers `'false'`, which is
    // truthy. That mistake was live in six places on this station.
    it('does nothing at all when the switch is off, including when it is the string "false"', async () => {
        const { service, llm, notes } = harness({ enabled: 'false' });

        const summary = await service.run();

        expect(summary.read).toBe(0);
        expect(llm.canGenerate).not.toHaveBeenCalled();
        expect(notes.addAll).not.toHaveBeenCalled();
    });

    it('does nothing when the station has no model, which is an ordinary state', async () => {
        const { service, notes, logger } = harness({ canGenerate: false });

        await service.run();

        expect(notes.addAll).not.toHaveBeenCalled();
        // At debug, not warn: a station with no model plugin is not a fault.
        expect(logger.debug).toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
    });

    // A habit is not visible in three breaks, and a pass that read them anyway would write a trait
    // out of a coincidence — which then sits in the system turn of every break until somebody
    // deletes it.
    it('leaves a thin window unread, and leaves its watermark alone so it keeps filling', async () => {
        const { service, llm, notes } = harness({ said: scripts(MIN_SCRIPTS - 1) });

        const summary = await service.run();

        expect(summary.read).toBe(0);
        expect(summary.considered).toBe(1);
        expect(llm.converse).not.toHaveBeenCalled();
        // `ran_at` still moves, which is how this is distinguishable from a pass that never ran.
        expect(notes.markRead).toHaveBeenCalledWith('pirate', undefined);
    });

    it('writes a verified saying straight into use', async () => {
        const { service, notes } = harness({
            answers: [noted([{ kind: 'said', note: 'called Booker T. the tightest band alive', quote: QUOTE }]), 'yes'],
        });

        const summary = await service.run();

        expect(notes.addAll).toHaveBeenCalledWith([
            expect.objectContaining({ personaKey: 'pirate', kind: 'said', state: 'active', origin: 'model', sourceQuote: QUOTE }),
        ]);
        expect(summary.active).toBe(1);
        expect(summary.suggested).toBe(0);
    });

    // The asymmetry the two kinds exist for. Nothing can entail an inference across several breaks,
    // so asking a verifier about it would either refuse every true one or teach the pass to write
    // weaker traits until they passed.
    it('proposes a trait rather than verifying it', async () => {
        const { service, notes, llm } = harness({
            answers: [noted([{ kind: 'trait', note: 'calls the listener shipmate', quote: QUOTE }])],
        });

        const summary = await service.run();

        expect(notes.addAll).toHaveBeenCalledWith([expect.objectContaining({ kind: 'trait', state: 'suggested' })]);
        expect(summary.suggested).toBe(1);
        // One call: the distillation. No verification was asked for.
        expect(llm.converse).toHaveBeenCalledTimes(1);
    });

    it('drops a saying the verifier will not stand behind', async () => {
        const { service, notes } = harness({
            answers: [noted([{ kind: 'said', note: 'called them the loudest band alive', quote: QUOTE }]), 'no'],
        });

        const summary = await service.run();

        expect(notes.addAll).toHaveBeenCalledWith([]);
        expect(summary.active).toBe(0);
    });

    // A verifier that said NOTHING is broken rather than unconvinced, and the two have to look
    // different from outside — this is the failure that hid a broken verifier in the fact pass for
    // months while it reported `kept=0` every run.
    it('drops the note when the verifier answers nothing, and says so at warn', async () => {
        const { service, notes, logger } = harness({
            answers: [noted([{ kind: 'said', note: 'called Booker T. the tightest band alive', quote: QUOTE }]), ''],
        });

        await service.run();

        expect(notes.addAll).toHaveBeenCalledWith([]);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('the verifier answered nothing'));
    });

    // Written first and marked second, which is the opposite of how a claim and its mark land
    // together elsewhere: these are two repositories that cannot share a transaction, so the only
    // question is which way a crash falls. Written-first re-reads and the unique index recognises the
    // duplicate; marked-first loses the observation for good.
    it('moves the watermark to the last script it read, after the notes are written', async () => {
        const said = scripts();
        const { service, notes } = harness({ said, answers: [noted([{ kind: 'trait', note: 'calls the listener shipmate', quote: QUOTE }])] });

        await service.run();

        expect(notes.addAll).toHaveBeenCalledBefore(notes.markRead as never);
        expect(notes.markRead).toHaveBeenCalledWith('pirate', said.at(-1)?.at);
    });

    it('leaves the watermark where it was when the model call throws', async () => {
        const { service, notes, llm, logger } = harness();
        llm.converse.mockRejectedValueOnce(new Error('the station is busy'));

        const summary = await service.run();

        expect(summary.failed).toBe(1);
        expect(notes.markRead).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalled();
    });

    // One row carrying a count, on `StationLineup.markAiring`'s rule, and only when something is
    // actually waiting: a pass that verified six sayings and proposed nothing has left the operator
    // no queue to clear and is not news.
    it('tells the feed once, with a count, and only when something is waiting', async () => {
        const proposed = harness({ answers: [noted([{ kind: 'trait', note: 'calls the listener shipmate', quote: QUOTE }])] });
        await proposed.service.run();

        expect(proposed.activity.record).toHaveBeenCalledTimes(1);
        expect(proposed.activity.record).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ suggested: 1 }) }));

        const verifiedOnly = harness({ answers: [noted([{ kind: 'said', note: 'called Booker T. the tightest band alive', quote: QUOTE }]), 'yes'] });
        await verifiedOnly.service.run();

        expect(verifiedOnly.activity.record).not.toHaveBeenCalled();
    });

    // Every character, not only the one on air: a persona that presents Tuesday mornings accumulates
    // just as much and would otherwise never be read.
    it('reads every character the station has', async () => {
        const { service, personas, history } = harness({ answers: [noted([]), noted([])] });
        personas.list.mockResolvedValueOnce([persona(), persona({ id: 'p2', key: 'latenight', active: false })]);

        await service.run();

        expect(history.writtenBy).toHaveBeenCalledWith('pirate', undefined, expect.any(Number));
        expect(history.writtenBy).toHaveBeenCalledWith('latenight', undefined, expect.any(Number));
    });
});
