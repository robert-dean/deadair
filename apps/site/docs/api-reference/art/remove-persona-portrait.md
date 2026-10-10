---
title: 'Remove persona portrait'
sidebar_label: 'Remove persona portrait'
sidebar_position: 10
mdx:
    format: 'md'
---

Takes a persona's picture away. A player shows the record's cover instead

**`DELETE`** `/art/personas/{personaId}`

:::note
SDK method: `removePersonaPortrait`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute   | Type     | Required | Description     |
| ----------- | -------- | -------- | --------------- |
| `personaId` | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [PersonaPortraitList](../models/art/persona-portrait-list.md) object.
