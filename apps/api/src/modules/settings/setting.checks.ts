import { INVITATION_KEYS, invitationBodyProblem, invitationSubjectProblem } from '#modules/mail/mail.invitation.js';

/**
 * Settings whose TEXT has rules of its own, beyond the type their descriptor declares: the check
 * answers why a value cannot be saved, or `undefined` when it can. An empty value is never checked,
 * since clearing one of these is how an operator goes back to the station's own.
 *
 * A table keyed by setting rather than a function on the descriptor, because the registry is sent to
 * the console as data and a function is not data. The rules themselves live with the module that
 * reads the setting, which is the one that knows what would break.
 */
const CHECKS: Readonly<Record<string, (value: string) => string | undefined>> = {
    [INVITATION_KEYS.subject]: invitationSubjectProblem,
    [INVITATION_KEYS.body]: invitationBodyProblem,
};

/** Why `value` cannot be saved under `key`, or `undefined` when it can (or when `key` has no rules of its own). */
export function settingTextProblem(key: string, value: string): string | undefined {
    if (value === '') return undefined;
    return CHECKS[key]?.(value);
}
