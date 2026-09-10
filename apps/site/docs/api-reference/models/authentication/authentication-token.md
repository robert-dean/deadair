---
title: 'AuthenticationToken'
sidebar_position: 16
mdx:
    format: 'md'
---

> Represents an authentication token

<details>
<summary>Attributes (5)</summary>

| Attribute      | Type     | Required | Description                                                               |
| -------------- | -------- | -------- | ------------------------------------------------------------------------- |
| `accessToken`  | `string` | Yes      | The access token string as issued by the authorization server             |
| `refreshToken` | `string` | No       | A refresh token which applications can use to obtain another access token |
| `expiresIn`    | `number` | Yes      | Unix timestamp (seconds) when the access token expires                    |
| `tokenType`    | `string` | Yes      | The type of token this is, typically just the string _Bearer_             |
| `scope`        | `string` | Yes      | Space-separated list of scopes granted to this token                      |

</details>
