// The scope vocabulary is derived from pdsl's output, so these pin what it derives to: a rename in
// core.perm changes the answer here before it changes what a key may do.

import { describe, expect, it } from 'vitest';

import {
    API_KEY_GRANTS,
    API_KEY_SCOPES,
    grantForPermission,
    isApiKeyScope,
    parseApiKeyScopes,
    scopeRelation,
} from '../../../src/modules/authentication/api.key.scopes.js';

describe('API_KEY_SCOPES', () => {
    it('is view and manage, in the order core.perm declares them', () => {
        expect(API_KEY_SCOPES).toEqual(['view', 'manage']);
    });

    it('leaves the relations that are not scopes out', () => {
        expect(API_KEY_SCOPES).not.toContain('owner');
        expect(API_KEY_SCOPES).not.toContain('station');
    });
});

describe('API_KEY_GRANTS', () => {
    it('is what a key may be checked for, without the owner-only revoke', () => {
        expect(API_KEY_GRANTS).toEqual(['view', 'manage']);
    });
});

describe('scopeRelation', () => {
    it('spells a scope as the relation core.perm declares', () => {
        expect(scopeRelation('view')).toBe('scoped_view');
        expect(scopeRelation('manage')).toBe('scoped_manage');
    });
});

describe('parseApiKeyScopes', () => {
    it('reads the scopes back from the relations an owner holds on a key', () => {
        expect(parseApiKeyScopes(['owner', 'scoped_manage', 'scoped_view'])).toEqual(['view', 'manage']);
    });

    it('drops a scoped relation core.perm does not declare', () => {
        // A hand-written tuple must not be a way to grant a scope nothing checks for.
        expect(parseApiKeyScopes(['scoped_everything', 'scoped_view'])).toEqual(['view']);
    });

    it('answers nothing for a key with no scope', () => {
        expect(parseApiKeyScopes(['owner'])).toEqual([]);
    });
});

describe('isApiKeyScope', () => {
    it('accepts the declared words and nothing else', () => {
        expect(isApiKeyScope('view')).toBe(true);
        expect(isApiKeyScope('manage')).toBe(true);
        expect(isApiKeyScope('*')).toBe(false);
        expect(isApiKeyScope('read')).toBe(false);
    });
});

describe('grantForPermission', () => {
    it('lets view through on a view grant', () => {
        expect(grantForPermission('view')).toBe('view');
    });

    it('asks for manage for every permission that changes something', () => {
        for (const permission of ['configure', 'enable', 'oauth', 'manage', 'edit']) {
            expect(grantForPermission(permission)).toBe('manage');
        }
    });
});
