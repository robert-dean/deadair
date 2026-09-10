---
title: 'AuthenticatorAuthenticationRequest'
sidebar_position: 13
mdx:
    format: 'md'
---

> Submit a TOTP code as a second factor against a pending MFA challenge

Extends [`BaseAuthenticationRequest`](./base-authentication-request.md)

<details>
<summary>Attributes (4)</summary>

| Attribute          | Type              | Required | Description                                                                                                          |
| ------------------ | ----------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `grant_type`       | `'authenticator'` | Yes      | The grant type for the request                                                                                       |
| `code`             | `string`          | Yes      | The TOTP code                                                                                                        |
| `mfa_challenge_id` | `string`          | Yes      | The pending MFA challenge — required, TOTP has no other actor binding at initial login                               |
| `method_id`        | `string`          | Yes      | The id of the enrolled authenticator factor to verify against (must be present in the MFA challenge's eligible list) |

</details>
