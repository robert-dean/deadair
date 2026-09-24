---
title: 'OAuthGrant'
sidebar_position: 16
mdx:
    format: 'md'
---

> An app the signed-in person has let act as them

<details>
<summary>Attributes (7)</summary>

| Attribute    | Type       | Required | Description                                                                      |
| ------------ | ---------- | -------- | -------------------------------------------------------------------------------- |
| `id`         | `string`   | Yes      | For disconnecting it                                                             |
| `clientId`   | `string`   | Yes      | The app's client id                                                              |
| `clientName` | `string`   | No       | What the app calls itself, when the station can still find out                   |
| `resource`   | `string`   | Yes      | What it can reach                                                                |
| `scope`      | `string[]` | Yes      | What it was granted: `mcp`, and the station scopes it may use (`view`, `manage`) |
| `createdAt`  | `string`   | Yes      | When it was first approved                                                       |
| `lastUsedAt` | `string`   | No       | When it last obtained a token                                                    |

</details>
