---
title: 'FidoAuthenticationLoginStartResponse'
sidebar_position: 41
mdx:
    format: 'md'
---

> WebAuthn assertion options for `navigator.credentials.get`

Extends [`BaseAuthenticationLoginStartResponse`](./base-authentication-login-start-response.md)

<details>
<summary>Attributes (2)</summary>

| Attribute    | Type                                    | Required | Description                     |
| ------------ | --------------------------------------- | -------- | ------------------------------- |
| `grant_type` | `'fido'`                                | Yes      | The grant type for the response |
| `assertion`  | `FidoPublicKeyCredentialRequestOptions` | Yes      | The WebAuthn assertion options  |

</details>
