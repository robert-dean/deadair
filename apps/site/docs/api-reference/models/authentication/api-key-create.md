---
title: 'ApiKeyCreate'
sidebar_position: 62
mdx:
    format: 'md'
---

> A new API key

<details>
<summary>Attributes (3)</summary>

| Attribute   | Type            | Required | Description                                                         |
| ----------- | --------------- | -------- | ------------------------------------------------------------------- |
| `name`      | `string`        | Yes      | What to call the key, so a list of several says which is which      |
| `scopes`    | `ApiKeyScope[]` | Yes      | What the key may do. At least one; `manage` includes `view`         |
| `expiresAt` | `string`        | No       | When the key should stop working. Omit for a key that never expires |

</details>
