---
title: 'Get hls playlist'
sidebar_label: 'Get hls playlist'
sidebar_position: 1
mdx:
    format: 'md'
---

One HLS playlist, and the tick that says somebody is still listening to it

**`GET`** `/hls/{name}`

:::note
SDK method: `getHLSPlaylist`
Security: public
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `name`    | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns `Blob`.

Response headers:

| Header          | Type     | Description |
| --------------- | -------- | ----------- |
| `cache-control` | `string` |             |

`404 Not Found`
