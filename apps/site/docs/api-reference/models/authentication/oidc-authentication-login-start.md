---
title: 'OidcAuthenticationLoginStart'
sidebar_position: 34
mdx:
    format: 'md'
---

> Request to begin an OIDC sign-in flow

Extends [`BaseAuthenticationLoginStart`](./base-authentication-login-start.md)

<details>
<summary>Attributes (2)</summary>

| Attribute    | Type           | Required | Description                    |
| ------------ | -------------- | -------- | ------------------------------ |
| `grant_type` | `'oidc'`       | Yes      | The grant type for the request |
| `provider`   | `OidcProvider` | Yes      | The IdP to authorize against   |

</details>
