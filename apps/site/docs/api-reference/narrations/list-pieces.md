---
title: 'List pieces'
sidebar_label: 'List pieces'
sidebar_position: 2
mdx:
    format: 'md'
---

The pieces the station knows about, in their series' own order, with what it has done with each

**`GET`** `/narrations/pieces`

:::note
SDK method: `listPieces`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute  | Type     | Required | Description                                                                   |
| ---------- | -------- | -------- | ----------------------------------------------------------------------------- |
| `limit`    | `number` | No       |                                                                               |
| `seriesId` | `string` | No       | One series' pieces in its own order, or absent for every series' newest first |

</details>

## Response

`200 OK` — Returns a [StationPiecePage](../models/narrations/station-piece-page.md) object.
