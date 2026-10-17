import { renderInvitation, type InvitationWording } from './mail.invitation.js';

/**
 * Every message the station sends, and what each one needs to say it.
 *
 * The map is the contract. {@link MailMessage} is indexed off it, so a `template` and a `data` that
 * do not belong together fail to compile rather than arriving at a renderer that quietly leaves a
 * placeholder in the body — which is the failure mode of a string-keyed template registry, and it
 * ships an email with `{code}` in it to the one person who cannot then sign in to report it.
 *
 * Most are the same sentence to a person waiting on a screen: here is a code, or here is a link. The
 * rest are about an account: an invitation to make one, and notices that its second step was reset
 * or its password changed. There is no marketing here and there is not going to be.
 */
export type MailTemplateMap = {
    /** A second factor at sign-in: the password was right and this proves the inbox. */
    SignInCode: { code: string; minutes: number };
    /** A first factor at sign-in: no password at all, the inbox is the whole proof. */
    SignInLink: { link: string; minutes: number };
    /** The same link, asked for from "Forgot your password?": it signs the person in and lands on the password form. */
    PasswordReset: { link: string; minutes: number };
    /** Proof an address exists before it is attached to an account. */
    VerifyEmail: { code: string; minutes: number };
    /** An admin invited this address into a role. `until` is already a date a person reads, such as `15 October 2026`. */
    Invitation: { link: string; role: 'admin' | 'listener'; inviter?: string; until: string };
    /** An admin removed this account's authenticator apps and passkeys. Sent so a reset nobody asked for is noticed. */
    SecondFactorReset: Record<string, never>;
    /** The account's password was set or changed. `added` when it had none before. Sent so a change nobody asked for is noticed. */
    PasswordChanged: { added: boolean };
};

export type MailTemplate = keyof MailTemplateMap;

/**
 * A message to send: a template and exactly the data that template takes.
 *
 * Written as a mapped type indexed by its own keys rather than as a generic, so that a call with
 * the wrong `data` for its `template` is rejected at the call site instead of being inferred into
 * something that satisfies both.
 */
export type MailMessage = {
    [T in MailTemplate]: { to: string; template: T; data: MailTemplateMap[T] };
}[MailTemplate];

/**
 * What the operator has written in place of the station's own words. Only the invitation is
 * offered: the rest are security notices, and {@link renderInvitation} says why that is where it
 * stops.
 */
export interface MailWording {
    invitation?: InvitationWording;
}

/** What a transport puts on the wire. Rendered, addressed, and free of any template vocabulary. */
export interface MailEnvelope {
    to: string;
    subject: string;
    /** Always present. The HTML is the alternative, never the only copy. */
    text: string;
    html: string;
}

/**
 * Render a message for a station that calls itself `stationName`.
 *
 * Text first and HTML second, deliberately: a one-time code is read and typed within about a
 * minute, often on a phone, sometimes in a client with images and styles off, and the plain part is
 * the one that always arrives intact. The HTML is the same words in a readable size — no images, no
 * tracking, no external stylesheet, nothing that a mail client will strip or a proxy will fetch.
 */
export function renderMail(message: MailMessage, stationName: string, wording: MailWording = {}): MailEnvelope {
    const rendered = body(message, stationName, wording);
    return { to: message.to, subject: rendered.subject, text: rendered.text, html: wrap(rendered.subject, rendered.html) };
}

function body(message: MailMessage, stationName: string, wording: MailWording): { subject: string; text: string; html: string } {
    switch (message.template) {
        case 'SignInCode': {
            const { code, minutes } = message.data;
            return {
                subject: `Your ${stationName} sign-in code`,
                text: [
                    `${code} is your code for signing in to ${stationName}.`,
                    '',
                    `It expires in ${plural(minutes, 'minute')}, and works once.`,
                    '',
                    'If you were not signing in, somebody has your password. Change it.',
                ].join('\n'),
                html: [
                    `<p>Your code for signing in to ${escapeHtml(stationName)}:</p>`,
                    `<p style="font-size:28px;font-weight:600;letter-spacing:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(code)}</p>`,
                    `<p>It expires in ${escapeHtml(plural(minutes, 'minute'))}, and works once.</p>`,
                    '<p>If you were not signing in, somebody has your password. Change it.</p>',
                ].join(''),
            };
        }
        case 'SignInLink': {
            const { link, minutes } = message.data;
            return {
                subject: `Sign in to ${stationName}`,
                text: [
                    `Open this link to sign in to ${stationName}:`,
                    '',
                    link,
                    '',
                    `It expires in ${plural(minutes, 'minute')}, and works once.`,
                    '',
                    'If you did not ask to sign in, ignore this. Anybody who can read this message can',
                    'use the link, so do not forward it.',
                ].join('\n'),
                html: [
                    `<p>Open this link to sign in to ${escapeHtml(stationName)}:</p>`,
                    `<p><a href="${escapeHtml(link)}" style="font-size:16px">Sign in to ${escapeHtml(stationName)}</a></p>`,
                    `<p>It expires in ${escapeHtml(plural(minutes, 'minute'))}, and works once.</p>`,
                    '<p>If you did not ask to sign in, ignore this. Anybody who can read this message can use the link, so do not forward it.</p>',
                ].join(''),
            };
        }
        case 'PasswordReset': {
            const { link, minutes } = message.data;
            return {
                subject: `Reset your ${stationName} password`,
                text: [
                    `Open this link to choose a new password for ${stationName}:`,
                    '',
                    link,
                    '',
                    `It signs you in, expires in ${plural(minutes, 'minute')}, and works once.`,
                    '',
                    'If you did not ask for this, ignore it: your password has not changed. Anybody who can',
                    'read this message can use the link, so do not forward it.',
                ].join('\n'),
                html: [
                    `<p>Open this link to choose a new password for ${escapeHtml(stationName)}:</p>`,
                    `<p><a href="${escapeHtml(link)}" style="font-size:16px">Choose a new password</a></p>`,
                    `<p>It signs you in, expires in ${escapeHtml(plural(minutes, 'minute'))}, and works once.</p>`,
                    '<p>If you did not ask for this, ignore it: your password has not changed. Anybody who can read this message can use the link, so do not forward it.</p>',
                ].join(''),
            };
        }
        case 'VerifyEmail': {
            const { code, minutes } = message.data;
            return {
                subject: `Confirm your email for ${stationName}`,
                text: [
                    `${code} is your code for confirming this address on ${stationName}.`,
                    '',
                    `It expires in ${plural(minutes, 'minute')}, and works once.`,
                    '',
                    'If you were not expecting this, nothing has happened to your address. Ignore it.',
                ].join('\n'),
                html: [
                    `<p>Your code for confirming this address on ${escapeHtml(stationName)}:</p>`,
                    `<p style="font-size:28px;font-weight:600;letter-spacing:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(code)}</p>`,
                    `<p>It expires in ${escapeHtml(plural(minutes, 'minute'))}, and works once.</p>`,
                    '<p>If you were not expecting this, nothing has happened to your address. Ignore it.</p>',
                ].join(''),
            };
        }
        case 'Invitation':
            return renderInvitation(message.data, stationName, wording.invitation);
        case 'SecondFactorReset': {
            return {
                subject: `Your second step on ${stationName} was reset`,
                text: [
                    `An admin of ${stationName} removed the authenticator apps and passkeys on your account and signed you out everywhere.`,
                    '',
                    'Sign in with your password and set up a new one from Sign-in and security.',
                    '',
                    'If you did not ask for this, tell whoever runs the station.',
                ].join('\n'),
                html: [
                    `<p>An admin of ${escapeHtml(stationName)} removed the authenticator apps and passkeys on your account and signed you out everywhere.</p>`,
                    '<p>Sign in with your password and set up a new one from Sign-in and security.</p>',
                    '<p>If you did not ask for this, tell whoever runs the station.</p>',
                ].join(''),
            };
        }
        case 'PasswordChanged': {
            const what = message.data.added
                ? `A password was added to your account on ${stationName}`
                : `The password on your ${stationName} account was changed`;
            return {
                subject: message.data.added ? `A password was added to your ${stationName} account` : `Your ${stationName} password was changed`,
                text: [
                    `${what}, and every other device signed in to it was signed out.`,
                    '',
                    'If this was you, there is nothing to do.',
                    '',
                    'If it was not, somebody can sign in as you. Tell whoever runs the station.',
                ].join('\n'),
                html: [
                    `<p>${escapeHtml(what)}, and every other device signed in to it was signed out.</p>`,
                    '<p>If this was you, there is nothing to do.</p>',
                    '<p>If it was not, somebody can sign in as you. Tell whoever runs the station.</p>',
                ].join(''),
            };
        }
    }
}

/**
 * The document around a rendered body.
 *
 * A `<title>`, a system font stack and a width. Mail clients rewrite or drop most of what a page
 * can carry, so this stops at what all of them keep.
 */
function wrap(subject: string, inner: string): string {
    return [
        '<!DOCTYPE html><html><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        `<title>${escapeHtml(subject)}</title></head>`,
        '<body style="margin:0;padding:24px;background:#f6f6f6">',
        '<div style="max-width:520px;margin:0 auto;padding:24px;background:#ffffff;border-radius:8px;',
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;",
        'font-size:15px;line-height:1.5;color:#1a1a1a">',
        inner,
        '</div></body></html>',
    ].join('');
}

/**
 * Escape for an HTML text node or a double-quoted attribute.
 *
 * Every interpolation in this file goes through it, including the ones that are currently a
 * six-digit code or a URL the station built itself. The station name is an operator-typed setting
 * and the link carries a base64url token, so two of the three are already attacker-adjacent; making
 * it the rule rather than a judgement per call site is what stops the fourth template from being
 * the one that forgot.
 */
function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
