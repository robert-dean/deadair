---
title: 'AuthenticationTokenIssued'
sidebar_position: 17
mdx:
    format: 'md'
---

> Issued-token arm of /auth/token response

<details>
<summary>Attributes (6)</summary>

| Attribute      | Type      | Required | Description                                                               |
| -------------- | --------- | -------- | ------------------------------------------------------------------------- |
| `result`       | `'token'` | Yes      | Discriminator                                                             |
| `accessToken`  | `string`  | Yes      | The access token string as issued by the authorization server             |
| `refreshToken` | `string`  | No       | A refresh token which applications can use to obtain another access token |
| `expiresIn`    | `number`  | Yes      | Unix timestamp (seconds) when the access token expires                    |
| `tokenType`    | `string`  | Yes      | The type of token this is, typically just the string _Bearer_             |
| `scope`        | `string`  | Yes      | Space-separated list of scopes granted to this token                      |

</details>
