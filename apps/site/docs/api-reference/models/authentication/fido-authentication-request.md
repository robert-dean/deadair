---
title: 'FidoAuthenticationRequest'
sidebar_position: 12
mdx:
    format: 'md'
---

> Represents an authentication passkey request

Extends [`BaseAuthenticationRequest`](./base-authentication-request.md)

<details>
<summary>Attributes (4)</summary>

| Attribute          | Type                               | Required | Description                                                                                                                                                                       |
| ------------------ | ---------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grant_type`       | `'fido'`                           | Yes      | The grant type for the request                                                                                                                                                    |
| `credential`       | `PublicKeyCredentialWithAssertion` | Yes      | A passkey credential object                                                                                                                                                       |
| `challenge_id`     | `string`                           | Yes      | The FIDO assertion challenge id returned by `POST /auth/login/start` (primary) or `POST /auth/factors/start` (MFA second factor). Must be the per-challenge id, not the actor id. |
| `mfa_challenge_id` | `string`                           | No       | When set, completes a pending MFA challenge instead of issuing a single-factor session                                                                                            |

</details>
