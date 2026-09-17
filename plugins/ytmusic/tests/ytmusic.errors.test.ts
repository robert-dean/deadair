import { PluginError } from '@deadair/plugin-sdk';
import { describe, expect, it } from 'vitest';
import { Utils } from 'youtubei.js';

import { isUnavailable, toPluginError } from '../src/ytmusic.errors.js';

/** The exact error a dead cookie produced against a live account. */
const deadCookie = () => new Utils.ParsingError('Expected node of any type Grid, MusicShelf, got ItemSection');

describe('a dead cookie', () => {
    it("is 'auth' when the call needed the credential", () => {
        // Measured: an expired cookie does not get a 401. The upstream serves a signed-out PAGE and
        // youtubei.js fails to find the nodes it wanted in it, so the failure arrives looking like a
        // library bug. It is the credential.
        expect(toPluginError(deadCookie(), 'authenticated')).toMatchObject({ code: 'auth' });
    });

    it("is not 'upstream', which would quarantine the plugin and hide the cause", () => {
        // 'upstream' counts against plugin health, so three of these take the plugin off the air for
        // a fault no retry can clear -- while telling the operator YouTube is having trouble when
        // what they need to do is paste a new cookie.
        expect(toPluginError(deadCookie(), 'authenticated').code).not.toBe('upstream');
    });

    it('keeps its innocent reading on a public call, where the credential is not in question', () => {
        expect(toPluginError(deadCookie(), 'public')).toMatchObject({ code: 'upstream' });
    });
});

describe('toPluginError', () => {
    it("maps a signed-out refusal to 'auth'", () => {
        const error = new Utils.InnertubeError('You must be signed in to perform this operation.');
        expect(toPluginError(error, 'authenticated')).toMatchObject({ code: 'auth' });
    });

    it("maps an unknown video to 'not_found', which does not count against plugin health", () => {
        expect(toPluginError(new Utils.InnertubeError('This video is unavailable'), 'public')).toMatchObject({ code: 'not_found' });
    });

    it("maps a region or age refusal to 'forbidden' rather than 'auth'", () => {
        // Resource-scoped on the host side. Classifying a per-item refusal as 'auth' takes the whole
        // plugin down on the very first age-gated record.
        expect(toPluginError(new Utils.InnertubeError('This video is not available in your country'), 'public')).toMatchObject({ code: 'forbidden' });
        expect(toPluginError(new Utils.InnertubeError('Sign in to confirm your age'), 'public')).toMatchObject({ code: 'forbidden' });
    });

    it("falls back to 'upstream' for anything it does not recognise", () => {
        expect(toPluginError(new Error('connection reset'), 'public')).toMatchObject({ code: 'upstream' });
    });

    it('passes a PluginError through untouched, so a code is never overwritten downstream', () => {
        const original = new PluginError('already judged').withCode('rate_limited');
        expect(toPluginError(original, 'authenticated')).toBe(original);
    });
});

describe('isUnavailable', () => {
    it('recognises the unknown-record failure that getTrack answers with undefined', () => {
        expect(isUnavailable(new Utils.InnertubeError('This video is unavailable'))).toBe(true);
        expect(isUnavailable(new Utils.InnertubeError('You must be signed in'))).toBe(false);
    });
});
