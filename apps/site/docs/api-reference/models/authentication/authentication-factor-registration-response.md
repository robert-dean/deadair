---
title: 'AuthenticationFactorRegistrationResponse'
sidebar_position: 79
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
