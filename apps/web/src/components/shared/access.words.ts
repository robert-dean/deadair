import { i18n } from '../../i18n/i18n.setup';

/**
 * What a credential acting for somebody may do, in the words the console uses for it: an API key the
 * person made, or an app they connected. Both are narrowed to the same two station scopes on the API,
 * and `manage` includes `view` there, so one choice is one scope.
 */
export type AccessScope = 'view' | 'manage';

/** The two choices, Read only first. `label` is a getter, so it is read in the language on screen. */
export const ACCESS_CHOICES: ReadonlyArray<{ value: AccessScope; label: string }> = (['view', 'manage'] as const).map(value => ({
    value,
    get label() {
        return i18n.t(`common:access.${value}`);
    },
}));

/** The word for what a key or a connected app holds, from its scopes as the API reports them. */
export function accessWord(scopes: ReadonlyArray<string>): string {
    return scopes.includes('manage')
        ? i18n.t('common:access.manage')
        : scopes.includes('view')
          ? i18n.t('common:access.view')
          : i18n.t('common:access.nothing');
}
