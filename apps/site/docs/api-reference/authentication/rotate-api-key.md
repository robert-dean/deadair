---
title: 'Rotate api key'
sidebar_label: 'Rotate api key'
sidebar_position: 3
mdx:
    format: 'md'
---

Give a key a new token, so the old one stops working at once. The key keeps its name, scopes and expiry. Needs the same recent second factor as creating one

**`POST`** `/auth/apikeys/{id}/rotate`

:::note
SDK method: `rotateAPIKey`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [ApiKeyIssued](../models/authentication/api-key-issued.md) object.
