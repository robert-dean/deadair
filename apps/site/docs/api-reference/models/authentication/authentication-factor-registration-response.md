---
title: 'AuthenticationFactorRegistrationResponse'
sidebar_position: 82
mdx:
    format: 'md'
---

```typescript
type AuthenticationFactorRegistrationResponse =
    | PhoneFactorRegistrationResponse
    | PasswordFactorRegistrationResponse
    | EmailFactorRegistrationResponse
    | AuthenticatorFactorRegistrationResponse
    | FidoFactorRegistrationResponse
    | OidcFactorRegistrationResponse;
```
