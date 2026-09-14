// The contract's `ApiKeyScope` enum is the one copy of the scope vocabulary that cannot be derived
// from core.perm, because ContractKit is a separate generator. This keeps the two equal.

import { describe, expect, it } from 'vitest';

import { API_KEY_SCOPES } from '../../../src/modules/authentication/api.key.scopes.js';
import { ApiKeyScope } from '../../../src/modules/authentication/types/authentication.types.js';

describe('the ApiKeyScope contract enum', () => {
    it('names exactly the scopes the apikey namespace declares', () => {
        expect([...ApiKeyScope.options]).toEqual([...API_KEY_SCOPES]);
    });
});
