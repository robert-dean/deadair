---
title: 'List episodes'
sidebar_label: 'List episodes'
sidebar_position: 3
mdx:
    format: 'md'
---

The episodes the station knows about, newest first, with what it has done with each

**`GET`** `/podcasts/episodes`

:::note
SDK method: `listEpisodes`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute | Type     | Required | Description                                                   |
| --------- | -------- | -------- | ------------------------------------------------------------- |
| `limit`   | `number` | No       |                                                               |
| `showId`  | `string` | No       | One show's episodes, or absent for every show's, newest first |

</details>

## Response

`200 OK` — Returns a [StationEpisodePage](../models/podcasts/station-episode-page.md) object.
