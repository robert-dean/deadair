---
title: 'OidcAuthenticationLoginStartResponse'
sidebar_position: 42
mdx:
    format: 'md'
---

> Response from `/auth/login/oidc/start` instructing the client to navigate to `authorize_url`

Extends [`BaseAuthenticationLoginStartResponse`](./base-authentication-login-start-response.md)

<details>
<summary>Attributes (3)</summary>

| Attribute       | Type     | Required | Description                                                       |
| --------------- | -------- | -------- | ----------------------------------------------------------------- |
| `grant_type`    | `'oidc'` | Yes      | The grant type for the response                                   |
| `authorize_url` | `string` | Yes      | Fully-formed authorize URL the user-agent should be redirected to |
| `state`         | `string` | Yes      | Opaque state token bound to this authorization round-trip         |

</details>
