/**
 * What a credential acting for somebody may do, in the words the console uses for it: an API key the
 * person made, or an app they connected. Both are narrowed to the same two station scopes on the API,
 * and `manage` includes `view` there, so one choice is one scope.
 */
export type AccessScope = 'view' | 'manage';

export const ACCESS_CHOICES: ReadonlyArray<{ value: AccessScope; label: string }> = [
    { value: 'view', label: 'Read only' },
    { value: 'manage', label: 'Read and manage' },
];

/** The word for what a key or a connected app holds, from its scopes as the API reports them. */
export function accessWord(scopes: ReadonlyArray<string>): string {
    return scopes.includes('manage') ? 'Read and manage' : scopes.includes('view') ? 'Read only' : 'Nothing';
}
