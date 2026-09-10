---
title: 'Get art'
sidebar_label: 'Get art'
sidebar_position: 1
mdx:
    format: 'md'
---

The bytes of one cached image

**`GET`** `/art/{id}`

:::note
SDK method: `getArt`
Security: public
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

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
