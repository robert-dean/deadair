import { fillPlaceholders, placeholdersIn, renderMailMarkdown, type MailValues } from './mail.markdown.js';
import type { MailTemplateMap } from './mail.templates.js';

/**
 * The invitation: the one message a station may word for itself.
 *
 * It is the one that is a welcome rather than a security notice. The others stay fixed because
 * their warnings do work ("if you were not signing in, somebody has your password"), and a sign-in
 * message an operator can reword is a phishing template with the station's name on it.
 */
export const INVITATION_KEYS = {
    subject: 'mail.invitation.subject',
    body: 'mail.invitation.body',
} as const;

/** What the operator wrote. Either half absent sends the station's own for that half. */
export interface InvitationWording {
    subject?: string;
    body?: string;
}

type InvitationData = MailTemplateMap['Invitation'];

/**
 * Every placeholder an invitation body may use, and what fills it. The list is the contract the
 * settings page's help text describes, and a body naming anything else is refused when it is saved.
 */
export const INVITATION_PLACEHOLDERS = ['station', 'role', 'inviter', 'link', 'until', 'androidApp', 'iosApp', 'guide'] as const;

/** The placeholders a subject may use: the ones that always have a value, since a header has no line to drop. */
export const INVITATION_SUBJECT_PLACEHOLDERS = ['station', 'role'] as const;

/**
 * Where the listener apps are published. `undefined` is an app that is not in a store yet, and the
 * invitation leaves its line out until it is: the iPhone app is built from `apps/ios` and is not on
 * the App Store, so filling this in is what puts it in every invitation sent afterwards.
 */
const LISTENER_APPS: { android: string | undefined; ios: string | undefined } = {
    android: 'https://play.google.com/store/apps/details?id=com.maroonedsoftware.deadair',
    ios: undefined,
};

/** The page on the deadair site for somebody just arriving in each role. */
const GUIDES: Record<InvitationData['role'], string> = {
    admin: 'https://deadair.radio/docs/tutorials/first-hour',
    listener: 'https://deadair.radio/docs/features/listening',
};

/** Render an invitation, in the operator's words where they wrote some and the station's own otherwise. */
export function renderInvitation(
    data: InvitationData,
    stationName: string,
    wording: InvitationWording = {},
): { subject: string; text: string; html: string } {
    const values = invitationValues(data, stationName);
    const subject =
        wording.subject === undefined
            ? data.role === 'admin'
                ? `You are invited to run ${stationName}`
                : `You are invited to ${stationName}`
            : fillPlaceholders(wording.subject, values);
    return { subject, ...renderMailMarkdown(wording.body ?? builtInBody(data.role, data.inviter !== undefined), values) };
}

function invitationValues(data: InvitationData, stationName: string): MailValues {
    return {
        station: stationName,
        role: data.role,
        // Present and undefined when nobody is named, so an operator's line about who sent it is
        // left out rather than refused.
        inviter: data.inviter,
        link: data.link,
        until: data.until,
        androidApp: LISTENER_APPS.android,
        iosApp: LISTENER_APPS.ios,
        guide: GUIDES[data.role],
    };
}

function builtInBody(role: InvitationData['role'], named: boolean): string {
    const who = named ? '{{inviter}} has invited you' : 'You have been invited';
    const what = role === 'admin' ? 'to run {{station}}' : 'to listen to {{station}}';
    const guide =
        role === 'admin'
            ? '[Your first hour on air]({{guide}}) walks through getting the station playing and talking.'
            : '[How listening works]({{guide}}), on the deadair site.';
    return [
        `${who} ${what}.`,
        '[Make your account]({{link}})',
        'You will choose a password and set up an authenticator app or a passkey. The link works once, until {{until}}.',
        'Then you can listen on your phone:',
        '- [Android, on Google Play]({{androidApp}})\n- [iPhone, on the App Store]({{iosApp}})',
        guide,
        'If you were not expecting this, ignore it. Anybody who can read this message can use the link, so do not forward it.',
    ].join('\n\n');
}

/**
 * Why an invitation body cannot be saved, or `undefined` when it can.
 *
 * Refused when it is typed rather than discovered when it is sent, because the person who would
 * discover it is somebody with no account yet, holding a message they cannot act on.
 */
export function invitationBodyProblem(body: string): string | undefined {
    const unknown = unknownIn(body, INVITATION_PLACEHOLDERS);
    if (unknown !== undefined) return unknown;
    if (!placeholdersIn(body).includes('link')) return 'it has to include {{link}}, or the person invited has no way to make their account';
    // Trial renders, which catch what reading the placeholders cannot: one used where a link's
    // address goes when it is not an address, such as [our station]({{station}}), and a link that
    // shares a line with a placeholder that can be empty, and so goes with it.
    const link = 'https://station.example/invite#sample';
    for (const inviter of ['someone@example.com', undefined]) {
        try {
            const { text } = renderMailMarkdown(body, invitationValues({ link, role: 'listener', inviter, until: '1 January 2030' }, 'Station'));
            if (!text.includes(link)) {
                return 'its {{link}} shares a line with a placeholder that can be empty ({{inviter}} or {{iosApp}}), so the invitation could arrive without one';
            }
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    }
    return undefined;
}

/** Why an invitation subject cannot be saved, or `undefined` when it can. */
export function invitationSubjectProblem(subject: string): string | undefined {
    return unknownIn(subject, INVITATION_SUBJECT_PLACEHOLDERS);
}

function unknownIn(source: string, known: readonly string[]): string | undefined {
    const unknown = placeholdersIn(source).filter(name => !known.includes(name));
    if (unknown.length === 0) return undefined;
    const named = unknown.map(name => `{{${name}}}`).join(', ');
    return `it names ${named}, which nothing fills. It can use ${known.map(name => `{{${name}}}`).join(', ')}`;
}
