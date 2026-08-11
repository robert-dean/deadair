// This is the reading that turns two silent failures into one sentence, and the
// way it fails is by crying wolf: an operator who has been shown a false "restart
// icecast" once will not act on the true one. So most of what is asserted here is
// SILENCE — no render yet, no answer from Icecast, no answer from Liquidsoap, a
// script too old to report its generation. Every one of those is "unknown", and
// unknown must never be reported as stale.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import type { IcecastServerReading, IcecastStatsClient } from '../../../src/modules/stream/icecast.stats.client.js';
import type { StreamConfigRender } from '../../../src/modules/stream/stream.config.js';
import { StreamConfigWatch } from '../../../src/modules/stream/stream.staleness.js';

const RENDERED_AT = Date.UTC(2026, 7, 11, 12, 33, 0);
/** Icecast started a quarter of an hour before the render, which is the observed failure. */
const STARTED_BEFORE = Date.UTC(2026, 7, 11, 12, 17, 0);

const render = (overrides: Partial<StreamConfigRender> = {}): StreamConfigRender => ({
    icecast: { path: '/vol/icecast.xml', stamp: 'aaaaaaaaaaaa', changedAt: RENDERED_AT },
    radio: { path: '/vol/radio.env', stamp: 'bbbbbbbbbbbb', changedAt: RENDERED_AT },
    ...overrides,
});

function build(server?: IcecastServerReading) {
    const reading = { current: server };
    const stats = {
        serverReading: () => reading.current,
        mountPath: () => '/live.mp3',
    } as unknown as IcecastStatsClient;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

    return { watch: new StreamConfigWatch(stats, logger), logger, reading };
}

describe('StreamConfigWatch', () => {
    it('says nothing before anything has been rendered', () => {
        const { watch } = build({ startedAt: STARTED_BEFORE, sourceConnected: true });
        watch.noteLiquidsoap({ stamp: 'something-else', driving: true });

        expect(watch.warnings()).toEqual([]);
    });

    it('reports icecast when it started before its config last changed', () => {
        const { watch } = build({ startedAt: STARTED_BEFORE, sourceConnected: true });
        watch.noteRender(render());

        const [warning, ...rest] = watch.warnings();
        expect(rest).toEqual([]);
        expect(warning?.container).toBe('icecast');
        expect(warning?.restart).toBe('docker compose restart icecast');
        expect(warning?.detail).toContain('/vol/icecast.xml');
        // Both instants, so an operator can match them against the container's own log.
        expect(warning?.detail).toContain('2026-08-11T12:17:00.000Z');
        expect(warning?.detail).toContain('2026-08-11T12:33:00.000Z');
    });

    it('leaves icecast alone when it started after the render', () => {
        const { watch } = build({ startedAt: RENDERED_AT + 60_000, sourceConnected: true });
        watch.noteRender(render());

        expect(watch.warnings()).toEqual([]);
    });

    it('leaves icecast alone when it came up while the app was rendering', () => {
        // The two clocks are the same host kernel, but a container starting a second
        // before the render that configured it is an ordinary cold boot, not drift.
        const { watch } = build({ startedAt: RENDERED_AT - 1_000, sourceConnected: true });
        watch.noteRender(render());

        expect(watch.warnings()).toEqual([]);
    });

    it('says nothing about an icecast that is not answering', () => {
        // An unreachable Icecast has not been accused of anything. Reporting it as stale
        // would send an operator to restart the one container that is not the problem.
        const { watch } = build(undefined);
        watch.noteRender(render());

        expect(watch.warnings()).toEqual([]);
    });

    it('says nothing when icecast answered but would not say when it started', () => {
        const { watch } = build({ sourceConnected: true });
        watch.noteRender(render());

        expect(watch.warnings()).toEqual([]);
    });

    it('reports liquidsoap when it booted with a different generation of radio.env', () => {
        const { watch } = build({ startedAt: RENDERED_AT + 60_000, sourceConnected: true });
        watch.noteRender(render());
        watch.noteLiquidsoap({ stamp: 'cccccccccccc', driving: true });

        const [warning] = watch.warnings();
        expect(warning?.container).toBe('liquidsoap');
        expect(warning?.restart).toBe('docker compose restart liquidsoap');
        expect(warning?.detail).toContain('cccccccccccc');
        expect(warning?.detail).toContain('bbbbbbbbbbbb');
    });

    it('leaves liquidsoap alone when its generation matches', () => {
        const { watch } = build({ startedAt: RENDERED_AT + 60_000, sourceConnected: true });
        watch.noteRender(render());
        watch.noteLiquidsoap({ stamp: 'bbbbbbbbbbbb', driving: true });

        expect(watch.warnings()).toEqual([]);
    });

    it('says nothing about a liquidsoap that did not answer', () => {
        const { watch } = build({ startedAt: RENDERED_AT + 60_000, sourceConnected: true });
        watch.noteRender(render());
        watch.noteLiquidsoap({ stamp: 'cccccccccccc', driving: true });
        watch.noteLiquidsoap(undefined);

        expect(watch.warnings()).toEqual([]);
    });

    it('falls back to the shape of the fault for a script that reports no generation', () => {
        // The observed failure: liquidsoap is up and believes it is driving, and Icecast
        // has no source on the mount, because the source password was refused.
        const { watch } = build({ startedAt: RENDERED_AT + 60_000, sourceConnected: false });
        watch.noteRender(render());
        watch.noteLiquidsoap({ driving: true });

        const [warning] = watch.warnings();
        expect(warning?.container).toBe('liquidsoap');
        expect(warning?.detail).toContain('/live.mp3');
        // It says out loud that this is a shape and not a proof, because it is.
        expect(warning?.detail).toContain('rather than proof');
    });

    it('does not read a station that is simply off air as a refused source', () => {
        // Nothing is driving, so an empty mount is exactly what should be there.
        const { watch } = build({ startedAt: RENDERED_AT + 60_000, sourceConnected: false });
        watch.noteRender(render());
        watch.noteLiquidsoap({ driving: false });

        expect(watch.warnings()).toEqual([]);
    });

    it('prefers the generation it can prove over the shape of the fault', () => {
        // Both tests would fire. The stamp names the cause, so it is the one reported,
        // and the operator is not shown the same container twice.
        const { watch } = build({ startedAt: RENDERED_AT + 60_000, sourceConnected: false });
        watch.noteRender(render());
        watch.noteLiquidsoap({ stamp: 'cccccccccccc', driving: true });

        const warnings = watch.warnings();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]?.detail).toContain('generation cccccccccccc');
    });

    it('reports both containers when a reseed left both behind', () => {
        // The observed incident: one query regenerated every stream secret, so Icecast
        // refused every listener and Liquidsoap could not connect as a source.
        const { watch } = build({ startedAt: STARTED_BEFORE, sourceConnected: false });
        watch.noteRender(render());
        watch.noteLiquidsoap({ stamp: 'cccccccccccc', driving: true });

        expect(watch.warnings().map(warning => warning.container)).toEqual(['icecast', 'liquidsoap']);
    });

    it('names the restart command in the log, once, on the edge', () => {
        const { watch, logger } = build({ startedAt: STARTED_BEFORE, sourceConnected: true });
        watch.noteRender(render());
        watch.noteRender(render());

        const warn = vi.mocked(logger.warn);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain('Run: docker compose restart icecast');
    });

    it('says so when the restart worked', () => {
        // The operator who ran the command deserves to hear it from the thing that told
        // them to run it, rather than by watching a warning stop appearing.
        const { watch, logger, reading } = build({ startedAt: STARTED_BEFORE, sourceConnected: true });
        watch.noteRender(render());

        reading.current = { startedAt: RENDERED_AT + 60_000, sourceConnected: true };
        watch.noteRender(render());

        expect(vi.mocked(logger.info).mock.calls.at(-1)?.[0]).toContain('running the current config');
    });
});
