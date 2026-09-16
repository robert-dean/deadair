---
title: 'Get art file'
sidebar_label: 'Get art file'
sidebar_position: 2
mdx:
    format: 'md'
---

The bytes of one cached image, under any filename

**`GET`** `/art/{id}/{filename}`

:::note
SDK method: `getArtFile`
Security: public
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute  | Type     | Required | Description     |
| ---------- | -------- | -------- | --------------- |
| `filename` | `string` | Yes      | Path parameter. |
| `id`       | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` `image/jpeg` — Returns `Blob`.

`200` `image/png` — Returns `Blob`.

`200` `image/webp` — Returns `Blob`.

`200` `image/gif` — Returns `Blob`.

Response headers:

| Header          | Type     | Description |
| --------------- | -------- | ----------- |
| `cache-control` | `string` |             |
| `etag`          | `string` |             |

`304`
