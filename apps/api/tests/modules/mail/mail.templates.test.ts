// What the station actually says, and the two properties that hold across all of it: a plain-text
// part that is never empty, and no interpolation reaching the HTML unescaped. The second matters
// more than it looks — the station name is an operator-typed setting and the sign-in link carries a
// token, so two of the three interpolations are already attacker-adjacent.

import { describe, expect, it } from 'vitest';

import { MailMessage, renderMail } from '../../../src/modules/mail/mail.templates.js';

const STATION = 'Dead Air';

const messages: MailMessage[] = [
    { to: 'someone@example.com', template: 'SignInCode', data: { code: '123456', minutes: 10 } },
    {
        to: 'someone@example.com',
        template: 'SignInLink',
        data: { link: 'https://radio.example.com/auth/callback?token=t&challenge_id=c', minutes: 30 },
    },
    { to: 'someone@example.com', template: 'VerifyEmail', data: { code: '654321', minutes: 10 } },
];

describe('rendering a message', () => {
    it.each(messages)('gives $template a subject, a text part and an HTML part', message => {
        const envelope = renderMail(message, STATION);

        expect(envelope.to).toBe('someone@example.com');
        expect(envelope.subject.length).toBeGreaterThan(0);
        expect(envelope.text.length).toBeGreaterThan(0);
        expect(envelope.html).toContain('<!DOCTYPE html>');
    });

    it.each(messages)('names the station in $template, so the message says what it is for', message => {
        const envelope = renderMail(message, STATION);

        expect(`${envelope.subject} ${envelope.text}`).toContain(STATION);
    });

    it('puts the code in the text part, which is the one that always arrives intact', () => {
        const envelope = renderMail({ to: 'a@b.c', template: 'SignInCode', data: { code: '123456', minutes: 10 } }, STATION);

        expect(envelope.text).toContain('123456');
        expect(envelope.html).toContain('123456');
    });

    it('puts the link in the text part too, since a client with HTML off still has to sign in', () => {
        const link = 'https://radio.example.com/auth/callback?token=abc&challenge_id=def';
        const envelope = renderMail({ to: 'a@b.c', template: 'SignInLink', data: { link, minutes: 30 } }, STATION);

        expect(envelope.text).toContain(link);
    });

    it('says how long the code lasts, and counts in the right number', () => {
        expect(renderMail({ to: 'a@b.c', template: 'SignInCode', data: { code: '1', minutes: 10 } }, STATION).text).toContain('10 minutes');
        expect(renderMail({ to: 'a@b.c', template: 'SignInCode', data: { code: '1', minutes: 1 } }, STATION).text).toContain('1 minute');
    });

    it('escapes the station name, which is a setting an operator types', () => {
        const envelope = renderMail({ to: 'a@b.c', template: 'SignInCode', data: { code: '123456', minutes: 10 } }, '<script>alert(1)</script>');

        expect(envelope.html).not.toContain('<script>');
        expect(envelope.html).toContain('&lt;script&gt;');
    });

    // The href is built by the station, but the token in it is not something to trust into an
    // attribute unescaped: a `"` in a query value would end the attribute and start a new one.
    it('escapes the sign-in link into its href', () => {
        const envelope = renderMail(
            { to: 'a@b.c', template: 'SignInLink', data: { link: 'https://x.test/cb?t=a"onmouseover="alert(1)', minutes: 30 } },
            STATION,
        );

        expect(envelope.html).not.toContain('onmouseover="alert(1)"');
        expect(envelope.html).toContain('&quot;');
    });

    it('escapes an ampersand in the link, which every real one has', () => {
        const envelope = renderMail(
            { to: 'a@b.c', template: 'SignInLink', data: { link: 'https://x.test/cb?token=a&challenge_id=b', minutes: 30 } },
            STATION,
        );

        expect(envelope.html).toContain('token=a&amp;challenge_id=b');
    });

    // No images, no external stylesheet, no tracking pixel: nothing a mail client will strip or a
    // proxy will fetch on the recipient's behalf.
    it.each(messages)('loads nothing from anywhere for $template', message => {
        const envelope = renderMail(message, STATION);

        expect(envelope.html).not.toMatch(/<img|<link|url\(/i);
    });
});
