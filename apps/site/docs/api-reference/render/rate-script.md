---
title: 'Rate script'
sidebar_label: 'Rate script'
sidebar_position: 6
mdx:
    format: 'md'
---

What the operator thought of this attempt. Nothing acts on it automatically

**`PUT`** `/scripts/{id}/rating`

:::note
SDK method: `rateScript`
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

Accepts a [ScriptRatingInput](../models/render/script-rating-input.md) object.

## Response

`200 OK` — Returns a [ScriptAttempt](../models/render/script-attempt.md) object.
