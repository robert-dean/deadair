---
title: 'Get source art'
sidebar_label: 'Get source art'
sidebar_position: 4
mdx:
    format: 'md'
---

The bytes of a cover the station fetches on first ask, addressed by its sealed source

**`GET`** `/art/source/{token}`

:::note
SDK method: `getSourceArt`
Security: public
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `token`   | `string` | Yes      | Path parameter. |

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
