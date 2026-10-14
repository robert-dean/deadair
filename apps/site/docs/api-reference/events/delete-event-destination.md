---
title: 'Delete event destination'
sidebar_label: 'Delete event destination'
sidebar_position: 5
mdx:
    format: 'md'
---

Remove an event destination and its delivery log

**`DELETE`** `/events/destinations/{id}`

:::note
SDK method: `deleteEventDestination`
Security: authenticated (policy: platform.manage)
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
