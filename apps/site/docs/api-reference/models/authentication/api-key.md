---
title: 'ApiKey'
sidebar_position: 61
mdx:
    format: 'md'
---

> A personal API key, as its owner sees it in a list. The token itself is never returned after it is issued

<details>
<summary>Attributes (8)</summary>

| Attribute    | Type            | Required | Description                                                                                       |
| ------------ | --------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `id`         | `string`        | Yes      | The key's identifier, for rotating or revoking it                                                 |
| `name`       | `string`        | Yes      | What the account called the key                                                                   |
| `hint`       | `string`        | Yes      | The token's first characters, enough to recognise the key in a config file and far too few to use |
| `scopes`     | `ApiKeyScope[]` | Yes      | What the key was granted. A key never does more than the account that owns it                     |
| `createdAt`  | `string`        | Yes      | When the key was issued                                                                           |
| `expiresAt`  | `string`        | No       | When the key stops working. Absent means it never expires                                         |
| `lastUsedAt` | `string`        | No       | When the key was last used, to within five minutes. Absent means it has not been used             |
| `revokedAt`  | `string`        | No       | When the key was revoked. Present means every request made with it is refused                     |

</details>
