---
title: 'Remove a never-play rule'
sidebar_label: 'Remove a never-play rule'
sidebar_position: 27
mdx:
    format: 'md'
---

Removes a rule

**`DELETE`** `/rules/{id}`

:::note
SDK method: `removeANeverPlayRule`
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

`200 OK` — Returns a [BlockRuleList](../models/director/block-rule-list.md) object.

`404 Not Found`
