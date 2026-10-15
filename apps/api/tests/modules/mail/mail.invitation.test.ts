// The invitation in an operator's own words, and the checks that stand between what they type and
// somebody with no account yet holding a message they cannot act on.

import { describe, expect, it } from 'vitest';

import { invitationBodyProblem, invitationSubjectProblem, renderInvitation } from '../../../src/modules/mail/mail.invitation.js';

const DATA = { link: 'https://x.test/invite#di_abc', role: 'listener', inviter: 'boss@x.test', until: '20 October 2026' } as const;

describe("rendering an operator's invitation", () => {
    it('uses their subject and body, with the placeholders filled', () => {
        const rendered = renderInvitation(DATA, 'Dead Air', {
            subject: 'Come and listen to {{station}}',
            body: '# Welcome, new {{role}}\n\n{{inviter}} thought you would like it.\n\n[Join]({{link}}) before {{until}}.',
        });

        expect(rendered.subject).toBe('Come and listen to Dead Air');
        expect(rendered.html).toContain('<h1>Welcome, new listener</h1>');
        expect(rendered.html).toContain('<a href="https://x.test/invite#di_abc">Join</a> before 20 October 2026.');
        expect(rendered.text).toContain('boss@x.test thought you would like it.');
    });

    it('leaves out their line about who sent it when nobody is named', () => {
        const { text } = renderInvitation({ link: DATA.link, role: 'listener', until: 'soon' }, 'Dead Air', {
            body: '{{inviter}} sent this.\n\n[Join]({{link}})',
        });

        expect(text).toBe('Join (https://x.test/invite#di_abc)');
    });

    it("keeps the station's own subject when they wrote only a body", () => {
        const rendered = renderInvitation(DATA, 'Dead Air', { body: '[Join]({{link}})' });

        expect(rendered.subject).toBe('You are invited to Dead Air');
    });
});

describe('checking an invitation body before it is saved', () => {
    it('accepts one that includes the link', () => {
        expect(
            invitationBodyProblem('Hi from {{station}}.\n\n[Join]({{link}})\n\n- [Android]({{androidApp}})\n- [iPhone]({{iosApp}})'),
        ).toBeUndefined();
    });

    it('refuses one without the link', () => {
        expect(invitationBodyProblem('Welcome to {{station}}!')).toMatch(/\{\{link\}\}/);
    });

    it('refuses a placeholder nothing fills, and says which ones are offered', () => {
        const problem = invitationBodyProblem('Hi {{name}}. [Join]({{link}})');

        expect(problem).toContain('{{name}}');
        expect(problem).toContain('{{guide}}');
    });

    it('refuses a placeholder used as a link when it is not an address', () => {
        expect(invitationBodyProblem('[{{station}}]({{station}}) [Join]({{link}})')).toMatch(/https, http or mailto/);
    });

    it('refuses a link that shares a line with something that can be empty', () => {
        expect(invitationBodyProblem('{{inviter}} says [join]({{link}}).')).toMatch(/could arrive without one/);
    });
});

describe('checking an invitation subject before it is saved', () => {
    it('accepts the station and the role', () => {
        expect(invitationSubjectProblem('{{station}} wants you as a {{role}}')).toBeUndefined();
    });

    it('refuses a placeholder a header cannot drop', () => {
        expect(invitationSubjectProblem('{{inviter}} invited you')).toContain('{{inviter}}');
    });
});
