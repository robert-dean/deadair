---
title: 'Rewrite persona in station language'
sidebar_label: 'Rewrite persona in station language'
sidebar_position: 8
mdx:
    format: 'md'
---

Rewrites a character's own wording (its speech rules, sample lines, signature words, catchphrases, banned wording and phrasings) in the station's language, keeping who it is, and hands the sheet back unsaved

**`POST`** `/personas/{id}/rewrite`

:::note
SDK method: `rewritePersonaInStationLanguage`
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

`200 OK` — Returns a [GeneratedPersona](../models/personas/generated-persona.md) object.
