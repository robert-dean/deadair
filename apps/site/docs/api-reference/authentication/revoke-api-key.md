---
title: 'Revoke api key'
sidebar_label: 'Revoke api key'
sidebar_position: 4
mdx:
    format: 'md'
---

Revoke a key. Every request made with it is refused from the next one on. The key stays in the list, marked revoked

**`DELETE`** `/auth/apikeys/{id}`

:::note
SDK method: `revokeAPIKey`
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

`204 No Content`
