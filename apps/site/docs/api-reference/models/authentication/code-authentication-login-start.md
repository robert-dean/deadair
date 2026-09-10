---
title: 'CodeAuthenticationLoginStart'
sidebar_position: 32
mdx:
    format: 'md'
---

Extends [`BaseAuthenticationLoginStartWithEmail`](./base-authentication-login-start-with-email.md)

<details>
<summary>Attributes (2)</summary>

| Attribute        | Type     | Required | Description                                                                                                               |
| ---------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `grant_type`     | `'code'` | Yes      | The grant type for the request                                                                                            |
| `code_challenge` | `string` | Yes      | A base64url encoded SHA256 hash of a one time secret used to validate that the request starts and ends on the same device |

</details>
