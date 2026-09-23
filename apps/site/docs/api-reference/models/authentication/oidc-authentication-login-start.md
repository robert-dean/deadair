---
title: 'OidcAuthenticationLoginStart'
sidebar_position: 34
mdx:
    format: 'md'
---

> Request to begin an OIDC sign-in flow

Extends [`BaseAuthenticationLoginStart`](./base-authentication-login-start.md)

<details>
<summary>Attributes (3)</summary>

| Attribute        | Type           | Required | Description                                                                                                                                                                |
| ---------------- | -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grant_type`     | `'oidc'`       | Yes      | The grant type for the request                                                                                                                                             |
| `provider`       | `OidcProvider` | Yes      | The IdP to authorize against                                                                                                                                               |
| `redirect_after` | `string`       | No       | A path on the console to return to once signed in, such as `/settings/security`. Anything that is not a same-origin path is ignored and the console opens at its home page |

</details>
