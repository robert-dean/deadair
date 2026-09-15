import { describe, expect, it } from 'vitest';

import { nowPlayingSvg, PROGRESS_STEPS, progressStep, svgDataUri } from '../../src/display/key.image.js';

const COVER = 'data:image/jpeg;base64,/9j/4AAQ';
const MARK = 'data:image/png;base64,iVBORw0KGgo';

describe('progressStep', () => {
    it('falls on whole steps and stays inside the bar', () => {
        expect(progressStep(0)).toBe(0);
        expect(progressStep(0.5)).toBe(PROGRESS_STEPS / 2);
        expect(progressStep(1)).toBe(PROGRESS_STEPS);
        expect(progressStep(1.4)).toBe(PROGRESS_STEPS);
        expect(progressStep(-0.1)).toBe(0);
    });
});

describe('nowPlayingSvg', () => {
    it('embeds the cover with the SVG 1.1 link, which a renderer that is not a browser reads', () => {
        const svg = nowPlayingSvg({ cover: COVER, step: 9, tone: 'live', stale: false });
        expect(svg).toContain(`xlink:href="${COVER}"`);
        expect(svg).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    });

    it('draws the bar as far as the step, in the tally red while live', () => {
        const svg = nowPlayingSvg({ cover: COVER, step: PROGRESS_STEPS / 4, tone: 'live', stale: false });
        expect(svg).toContain('<rect width="36" height="8" fill="#FF4B4B"/>');
    });

    it('draws nothing live-coloured from a reading that is stale', () => {
        const svg = nowPlayingSvg({ cover: COVER, step: 9, tone: 'live', stale: true });
        expect(svg).not.toContain('#FF4B4B');
    });

    it('draws no shade for a key that shows no title', () => {
        expect(nowPlayingSvg({ cover: COVER, tone: 'live', stale: false })).toContain('url(#shade)"/>');
        expect(nowPlayingSvg({ cover: COVER, tone: 'live', stale: false, shade: false })).not.toContain('fill="url(#shade)"');
    });

    it('draws no bar for a record the station cannot measure', () => {
        expect(nowPlayingSvg({ cover: COVER, tone: 'live', stale: false })).not.toContain('height="8"');
    });

    it('draws the station’s mark when there is no cover, in full while the station is ready', () => {
        const svg = nowPlayingSvg({ tone: 'standby', stale: false, mark: MARK });
        expect(svg).toContain(`xlink:href="${MARK}"`);
        expect(svg).not.toContain('opacity="0.4"');
    });

    it('draws the mark faint for a station stood down, failing, or read long ago', () => {
        expect(nowPlayingSvg({ tone: 'off', stale: false, mark: MARK })).toContain('opacity="0.4"');
        expect(nowPlayingSvg({ tone: 'fault', stale: false, mark: MARK })).toContain('opacity="0.4"');
        expect(nowPlayingSvg({ tone: 'live', stale: true, mark: MARK })).toContain('opacity="0.4"');
    });

    it('draws the last cover faint once the station stops answering, and in full while it answers', () => {
        expect(nowPlayingSvg({ cover: COVER, step: 9, tone: 'live', stale: true })).toContain(`xlink:href="${COVER}" opacity="0.4"`);
        expect(nowPlayingSvg({ cover: COVER, step: 9, tone: 'live', stale: false })).not.toContain('opacity="0.4"');
    });

    it('prefers the cover to the mark', () => {
        const svg = nowPlayingSvg({ cover: COVER, tone: 'live', stale: false, mark: MARK });
        expect(svg).toContain(COVER);
        expect(svg).not.toContain(MARK);
    });

    it('falls back to a plain record in the station’s tone with no mark to draw', () => {
        const svg = nowPlayingSvg({ tone: 'standby', stale: false });
        expect(svg).not.toContain('<image');
        expect(svg).toContain('r="12" fill="#58A6FF"');
    });
});

describe('svgDataUri', () => {
    it('is URI-encoded, which is the form Elgato documents for an SVG', () => {
        expect(svgDataUri('<svg a="b"/>')).toBe('data:image/svg+xml,%3Csvg%20a%3D%22b%22%2F%3E');
    });
});
