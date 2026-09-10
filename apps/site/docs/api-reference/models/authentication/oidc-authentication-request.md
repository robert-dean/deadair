---
title: 'OidcAuthenticationRequest'
sidebar_position: 14
mdx:
    format: 'md'
---

> Redeem a completed OIDC authorization that the callback stashed under a one-time id

Extends [`BaseAuthenticationRequest`](./base-authentication-request.md)

<details>
<summary>Attributes (2)</summary>

| Attribute      | Type     | Required | Description                                                                                                                                                                                       |
| -------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grant_type`   | `'oidc'` | Yes      | The grant type for the request                                                                                                                                                                    |
| `challenge_id` | `string` | Yes      | The one-time stash id from the OIDC callback redirect (the value after `?token=oidc:` on `/auth/callback`). Single-use — the API consumes it via `OidcFactorService.redeemAuthenticatedExchange`. |

</details>
