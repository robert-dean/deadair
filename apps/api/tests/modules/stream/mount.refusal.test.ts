// What a test has to pin is who gets dropped and what comes back, because that number is taken off
// the audience: not knowing has to count everybody, and a list of nobody must not read Icecast at all.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import type { IcecastClientsClient, MountConnections } from '../../../src/modules/stream/icecast.clients.client.js';
import { MountRefusal } from '../../../src/modules/stream/mount.refusal.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

function build(list: string, mounts: MountConnections[], killed = true) {
    const clients = { connections: vi.fn(async () => mounts), kill: vi.fn(async () => killed) };
    const config = { get: () => list } as unknown as AppConfig;
    return { clients, refusal: new MountRefusal(clients as unknown as IcecastClientsClient, config, logger) };
}

const robot = { id: '1', address: '10.0.0.9', agent: 'Go-http-client/1.1', connectedMs: 1000 };
const person = { id: '2', address: '10.0.0.8', agent: 'Mozilla/5.0', connectedMs: 1000 };
const silent = { id: '3', address: '10.0.0.7', connectedMs: 1000 };

describe('MountRefusal', () => {
    it('asks Icecast nothing when the list is empty', async () => {
        const { clients, refusal } = build('  ', [{ mount: '/live.mp3', connections: [robot] }]);

        expect(refusal.refusing()).toBe(false);
        expect(await refusal.sweep()).toBe(0);
        expect(clients.connections).not.toHaveBeenCalled();
    });

    it('drops what matches on every mount, and leaves a person and a player that names nothing', async () => {
        const { clients, refusal } = build('go-http-client lavf/', [
            { mount: '/live.mp3', connections: [robot, person, silent] },
            { mount: '/live.opus', connections: [{ ...robot, id: '9', agent: 'Lavf/59.27.100' }] },
        ]);

        expect(refusal.refusing()).toBe(true);
        expect(await refusal.sweep()).toBe(2);
        expect(clients.kill.mock.calls).toEqual([
            ['/live.mp3', '1'],
            ['/live.opus', '9'],
        ]);
    });

    it('counts a mount it could not read as nobody refused', async () => {
        const { clients, refusal } = build('go-http-client', [{ mount: '/live.mp3', unreadable: 'unanswered' }]);

        expect(await refusal.sweep()).toBe(0);
        expect(clients.kill).not.toHaveBeenCalled();
    });

    it('still leaves a match out of the audience when Icecast would not drop it', async () => {
        const { refusal } = build('go-http-client', [{ mount: '/live.mp3', connections: [robot] }], false);

        expect(await refusal.sweep()).toBe(1);
    });

    it('never logs an address or a player', async () => {
        const { refusal } = build('go-http-client', [{ mount: '/live.mp3', connections: [robot] }]);

        await refusal.sweep();

        const logged = vi.mocked(logger.info).mock.calls.flat().join(' ');
        expect(logged).not.toContain(robot.address);
        expect(logged).not.toContain('Go-http');
    });
});
