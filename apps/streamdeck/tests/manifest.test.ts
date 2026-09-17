import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { NOW_PLAYING } from '../src/actions/now.playing.options.js';
import { DISLIKE, LIKE } from '../src/actions/vote.reading.js';

// `streamdeck validate` checks all of this too, but it fetches the manifest's URLs first and so needs
// the network, which a test run does not have. These are the parts that break without anybody
// editing the manifest: an image renamed under it, an action whose id stops matching the plugin's.
const plugin = resolve(import.meta.dirname, '../radio.deadair.streamdeck.sdPlugin');

interface State {
    Image: string;
}
interface Action {
    UUID: string;
    Icon: string;
    States: State[];
    Controllers: string[];
}
interface Manifest {
    UUID: string;
    Version: string;
    Icon: string;
    CategoryIcon: string;
    CodePath: string;
    PropertyInspectorPath: string;
    Nodejs: { Version: string };
    Actions: Action[];
}

const manifest = JSON.parse(readFileSync(join(plugin, 'manifest.json'), 'utf8')) as Manifest;
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string };

/** A PNG's pixel width, read off its header. */
function pngWidth(path: string): number {
    return readFileSync(path).readUInt32BE(16);
}

/** Whether Stream Deck can find the image a manifest path names: an SVG, or a PNG with its @2x beside it. */
function imageExists(path: string): boolean {
    const base = join(plugin, path);
    return existsSync(`${base}.svg`) || (existsSync(`${base}.png`) && existsSync(`${base}@2x.png`));
}

describe('the plugin manifest', () => {
    it('declares the actions the code registers by the ids it registers them under', () => {
        const declared = manifest.Actions.map(action => action.UUID);
        for (const uuid of [NOW_PLAYING, LIKE, DISLIKE]) expect(declared).toContain(uuid);
    });

    it('gives each vote key one state, because the plugin draws its face rather than switching between two', () => {
        for (const uuid of [LIKE, DISLIKE]) {
            expect(manifest.Actions.find(action => action.UUID === uuid)?.States).toHaveLength(1);
        }
    });

    it('names every action under the plugin’s own id', () => {
        for (const action of manifest.Actions) {
            expect(action.UUID.startsWith(`${manifest.UUID}.`)).toBe(true);
        }
    });

    it('has every image it names', () => {
        const paths = [manifest.CategoryIcon, ...manifest.Actions.flatMap(action => [action.Icon, ...action.States.map(state => state.Image)])];
        for (const path of paths) {
            expect(imageExists(path), path).toBe(true);
        }
    });

    it('has the station’s mark where the plugin reads it, at the size a key draws', () => {
        expect(pngWidth(join(plugin, 'imgs/plugin/mark.png'))).toBe(144);
    });

    it('has the plugin icon as a PNG at the two sizes the store asks for', () => {
        expect(pngWidth(join(plugin, `${manifest.Icon}.png`))).toBe(256);
        expect(pngWidth(join(plugin, `${manifest.Icon}@2x.png`))).toBe(512);
    });

    it('states the package’s version with a build number after it', () => {
        expect(manifest.Version).toBe(`${pkg.version}.0`);
    });

    it('runs the bundle the build writes, on a Node the Stream Deck app offers', () => {
        expect(manifest.CodePath).toBe('bin/plugin.js');
        expect(['20', '24']).toContain(manifest.Nodejs.Version);
    });

    it('has the property inspector it names, loading the script the build writes beside it', () => {
        const page = readFileSync(join(plugin, manifest.PropertyInspectorPath), 'utf8');
        expect(page).toContain('<script src="station.js"></script>');
    });

    it('offers every action on a key, and only on a key', () => {
        for (const action of manifest.Actions) {
            expect(action.Controllers).toEqual(['Keypad']);
        }
    });
});
