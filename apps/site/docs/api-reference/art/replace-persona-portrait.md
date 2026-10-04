---
title: 'Replace persona portrait'
sidebar_label: 'Replace persona portrait'
sidebar_position: 7
mdx:
    format: 'md'
---

Puts a picture on a persona. A persona that already had one keeps its URL, so a player holding it picks up the new picture

**`POST`** `/art/personas/{personaId}`

:::note
SDK method: `replacePersonaPortrait`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute   | Type     | Required | Description     |
| ----------- | -------- | -------- | --------------- |
| `personaId` | `string` | Yes      | Path parameter. |

</details>

## Request body (`multipart/form-data`)

Accepts a [PersonaPortraitUpload](../models/art/persona-portrait-upload.md) object.

## Response

`200 OK` — Returns a [PersonaPortraitList](../models/art/persona-portrait-list.md) object.

`400 Bad Request`

`413`

`415`
