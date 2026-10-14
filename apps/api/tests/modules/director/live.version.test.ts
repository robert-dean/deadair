// Every title and album here is one the live station held on 2026-10-14. The refusals and the passes
// are held to the same weight: a miss airs a live record, and a false hit refuses a studio one with
// nothing on air to say why.

import { describe, expect, it } from 'vitest';

import { isLiveRecording } from '../../../src/modules/director/live.version.js';

describe('isLiveRecording', () => {
    it.each([
        ['Walk This Way - Live', 'A Little South Of Sanity'],
        ['War Pigs - Live', 'The End (Live)'],
        ['Rocket Queen - Live In Las Vegas / 1992', "Live Era '87-'93"],
        ['Seven Bridges Road - Live; 1999 Remaster', 'Eagles Live'],
        ['Who Knows - Live At Filmore East, New York/1970/1997 Digital Remaster', 'Band Of Gypsys (Live)'],
        ['For Whom the Bell Tolls (Live)', 'S&M2'],
        ["I'm Alive - Live at Up the Hammers Festival", "I'm Alive (Live at Up the Hammers Festival)"],
        ['Do You Feel Like We Do - Live', 'Frampton Comes Alive!'],
        ['Song - 2011 Remaster - Live', 'Album'],
        ['Tears in Heaven [MTV Unplugged]', 'Album'],
    ])('refuses "%s" by its title', (title, album) => {
        expect(isLiveRecording(title, album)).toBe(true);
        expect(isLiveRecording(title)).toBe(true);
    });

    it.each([
        ['Kids Of The Black Hole', 'Live At The House Of Blues'],
        ['Sacrificial Suicide', 'Live in Nottingham'],
        ['Sister Christian', 'Live In Tokyo'],
        ['Step Down', 'Live in a Dive'],
        ['The Number of the Beast', 'Live at Donington (1998 Remaster)'],
        ['In My Dreams', 'In My Dreams (Live)'],
        ['Sing Me Away', '24 Strings and a Drummer (Live and Acoustic)'],
        ['You Are The Woman', "'firefall Reunion Live'"],
        ['Johnny B. Goode', 'The Best of Rock and Roll Hall of Fame + Museum Live'],
        ['Forbidden Desires', 'Heed The Warning Demo & Live Recordings'],
        ['Wheels of Steel', 'Unplugged and Strung Up / Heavy Metal Thunder'],
        ['Feel Something', 'Deadweight [Feat. Caleb Shomo] (Live from Fayetteville / 2019)'],
    ])('refuses "%s" by its album, "%s"', (title, album) => {
        expect(isLiveRecording(title)).toBe(false);
        expect(isLiveRecording(title, album)).toBe(true);
    });

    it.each([
        ['Live Wire', 'High Voltage'],
        ['Live And Let Die', 'Use Your Illusion I'],
        ['Show Me How to Live', 'Audioslave'],
        ['War Broadcast Live', 'Bazookiller'],
        ['Live, Suffer, Die', 'Game Over'],
        ['Live Unholy', 'Live Unholy'],
        ["Ain't No Half-Steppin'", 'Long Live The Kane'],
        ["F**kin' Problems (feat. Drake, 2 Chainz & Kendrick Lamar)", 'LONG.LIVE.A$AP (Deluxe Version)'],
        ['Lil’ Darlin’', 'Long Live The Chief'],
        ['Silver - Silence Live Mix', 'Silver (Silence Live Mix)'],
        ['The Day I Tried To Live', 'Superunknown'],
        ['Long Live', 'Long Live'],
        ['Paranoid - 2012 - Remaster', 'Paranoid'],
    ])('lets "%s" on "%s" through', (title, album) => {
        expect(isLiveRecording(title, album)).toBe(false);
    });

    it('reads a missing or blank album as nothing to read', () => {
        expect(isLiveRecording('Roads', undefined)).toBe(false);
        expect(isLiveRecording('Roads', '  ')).toBe(false);
    });
});
