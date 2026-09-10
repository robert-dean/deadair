---
title: 'LinkAuthenticationRequest'
sidebar_position: 10
mdx:
    format: 'md'
---

> Represents an authentication magic link request

Extends [`BaseAuthenticationRequest`](./base-authentication-request.md)

<details>
<summary>Attributes (3)</summary>

| Attribute      | Type     | Required | Description                                                                                                                      |
| -------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `grant_type`   | `'link'` | Yes      | The grant type for the request                                                                                                   |
| `challenge_id` | `string` | Yes      | The email challenge id returned by `POST /auth/login/start` — binds the link to the issued challenge so cross-device clicks work |
| `link`         | `string` | Yes      | The magic link token                                                                                                             |

</details>
