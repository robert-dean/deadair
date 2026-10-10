---
title: 'Get source art file'
sidebar_label: 'Get source art file'
sidebar_position: 5
mdx:
    format: 'md'
---

The bytes of a cover the station fetches on first ask, under any filename

**`GET`** `/art/source/{token}/{filename}`

:::note
SDK method: `getSourceArtFile`
Security: public
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute  | Type     | Required | Description     |
| ---------- | -------- | -------- | --------------- |
| `filename` | `string` | Yes      | Path parameter. |
| `token`    | `string` | Yes      | Path parameter. |

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
