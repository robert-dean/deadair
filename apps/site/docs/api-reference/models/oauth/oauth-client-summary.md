---
title: 'OAuthClientSummary'
sidebar_position: 10
mdx:
    format: 'md'
---

> An app registered with the station

<details>
<summary>Attributes (8)</summary>

| Attribute                 | Type                           | Required | Description                                         |
| ------------------------- | ------------------------------ | -------- | --------------------------------------------------- |
| `clientId`                | `string`                       | Yes      | Its client id                                       |
| `kind`                    | `'preregistered' \| 'dynamic'` | Yes      | Created by an operator, or registered by itself     |
| `name`                    | `string`                       | No       | What it is called                                   |
| `redirectUris`            | `string[]`                     | Yes      | Where it may be sent back to                        |
| `tokenEndpointAuthMethod` | `OAuthClientAuthMethod`        | Yes      | How it proves itself                                |
| `createdAt`               | `string`                       | Yes      | When it was registered                              |
| `lastUsedAt`              | `string`                       | No       | When it last obtained a token                       |
| `expiresAt`               | `string`                       | No       | When a self-registered app lapses unless used again |

</details>
