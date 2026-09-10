---
title: 'CodeAuthenticationRequest'
sidebar_position: 11
mdx:
    format: 'md'
---

> Represents an authentication one-time-code request

Extends [`BaseAuthenticationRequest`](./base-authentication-request.md)

<details>
<summary>Attributes (5)</summary>

| Attribute          | Type     | Required | Description                                                                                                                                                     |
| ------------------ | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grant_type`       | `'code'` | Yes      | The grant type for the request                                                                                                                                  |
| `code`             | `string` | Yes      | The one-time code                                                                                                                                               |
| `code_verifier`    | `string` | No       | PKCE verifier — required for a primary code login; absent when mfa_challenge_id is set                                                                          |
| `mfa_challenge_id` | `string` | No       | When set, completes a pending MFA challenge; replaces code_verifier as proof-of-origin                                                                          |
| `challenge_id`     | `string` | No       | The phone/email challenge id (returned by POST /auth/factors/start for phone-MFA). Required when mfa_challenge_id is set; ignored otherwise (resolved via PKCE) |

</details>
