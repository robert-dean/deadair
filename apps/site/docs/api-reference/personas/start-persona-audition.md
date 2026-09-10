---
title: 'Start persona audition'
sidebar_label: 'Start persona audition'
sidebar_position: 2
mdx:
    format: 'md'
---

Asks the station to put this character through a playlist. It is queued, not written

**`POST`** `/personas/{id}/auditions`

:::note
SDK method: `startPersonaAudition`
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

Accepts a [PersonaAuditionRequest](../models/personas/persona-audition-request.md) object.

## Response

`201 Created` — Returns a [PersonaAudition](../models/personas/persona-audition.md) object.
