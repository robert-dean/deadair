---
title: 'Replace break artwork'
sidebar_label: 'Replace break artwork'
sidebar_position: 2
mdx:
    format: 'md'
---

Puts an operator's own picture behind a kind of break. The id does not change, so a URL already on the wire keeps working and the ETag is what says the picture moved

**`POST`** `/art/breaks/{kind}`

:::note
SDK method: `replaceBreakArtwork`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `kind`    | `string` | Yes      | Path parameter. |

</details>

## Request body (`multipart/form-data`)

Accepts a [BreakArtworkUpload](../models/art/break-artwork-upload.md) object.

## Response

`200 OK` — Returns a [BreakArtworkList](../models/art/break-artwork-list.md) object.

`400 Bad Request`

`413`

`415`
