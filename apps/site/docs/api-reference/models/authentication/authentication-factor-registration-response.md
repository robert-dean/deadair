---
title: 'AuthenticationFactorRegistrationResponse'
sidebar_position: 81
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
