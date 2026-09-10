---
title: 'List persona auditions'
sidebar_label: 'List persona auditions'
sidebar_position: 1
mdx:
    format: 'md'
---

Every audition of this character, newest first, without their breaks

**`GET`** `/personas/{id}/auditions`

:::note
SDK method: `listPersonaAuditions`
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

`200 OK` — Returns a [PersonaAuditionList](../models/personas/persona-audition-list.md) object.
