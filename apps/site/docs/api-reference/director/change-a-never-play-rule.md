---
title: 'Change a never-play rule'
sidebar_label: 'Change a never-play rule'
sidebar_position: 25
mdx:
    format: 'md'
---

Replaces a rule

**`PUT`** `/rules/{id}`

:::note
SDK method: `changeANeverPlayRule`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [BlockRule](../models/director/block-rule.md) object.

## Response

`200 OK` — Returns a [BlockRuleList](../models/director/block-rule-list.md) object.

`404 Not Found`
