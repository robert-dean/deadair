---
title: 'Get persona audition'
sidebar_label: 'Get persona audition'
sidebar_position: 3
mdx:
    format: 'md'
---

One audition with every break it has written so far, in order

**`GET`** `/personas/{id}/auditions/{auditionId}`

:::note
SDK method: `getPersonaAudition`
Security: authenticated (policy: platform.view)
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

`200 OK` — Returns a [PersonaAudition](../models/personas/persona-audition.md) object.
