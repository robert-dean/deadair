---
title: 'Rehearse persona'
sidebar_label: 'Rehearse persona'
sidebar_position: 30
mdx:
    format: 'md'
---

Writes a talk break under this persona against two fixed invented records, and answers with every writer that was asked

**`POST`** `/personas/{id}/rehearse`

:::note
SDK method: `rehearsePersona`
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

`200 OK` — Returns a [PersonaRehearsal](../models/personas/persona-rehearsal.md) object.
