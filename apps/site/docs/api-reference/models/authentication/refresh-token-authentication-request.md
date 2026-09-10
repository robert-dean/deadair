---
title: 'RefreshTokenAuthenticationRequest'
sidebar_position: 9
mdx:
    format: 'md'
---

> Represents an authentication refresh request

Extends [`BaseAuthenticationRequest`](./base-authentication-request.md)

<details>
<summary>Attributes (2)</summary>

| Attribute       | Type              | Required | Description                                                                                                                             |
| --------------- | ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `grant_type`    | `'refresh_token'` | Yes      | The grant type for the request                                                                                                          |
| `refresh_token` | `string`          | No       | The refresh token issued by the authorization server. Optional: browser clients omit it and present the httpOnly refresh cookie instead |

</details>
