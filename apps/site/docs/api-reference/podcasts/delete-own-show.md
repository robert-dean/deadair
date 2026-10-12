---
title: 'Delete own show'
sidebar_label: 'Delete own show'
sidebar_position: 9
mdx:
    format: 'md'
---

Removes a show. Its episodes stay on the Productions page, no longer filed under it

**`DELETE`** `/podcasts/own/{id}`

:::note
SDK method: `deleteOwnShow`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>
