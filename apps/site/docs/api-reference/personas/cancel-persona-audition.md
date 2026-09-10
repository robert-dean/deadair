---
title: 'Cancel persona audition'
sidebar_label: 'Cancel persona audition'
sidebar_position: 4
mdx:
    format: 'md'
---

Stops an audition where it stands, keeping the breaks it has already written

**`POST`** `/personas/{id}/auditions/{auditionId}/cancel`

:::note
SDK method: `cancelPersonaAudition`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute    | Type     | Required | Description     |
| ------------ | -------- | -------- | --------------- |
| `auditionId` | `string` | Yes      | Path parameter. |
| `id`         | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [PersonaAuditionSummary](../models/personas/persona-audition-summary.md) object.
