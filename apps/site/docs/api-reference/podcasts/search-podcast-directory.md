---
title: 'Search podcast directory'
sidebar_label: 'Search podcast directory'
sidebar_position: 2
mdx:
    format: 'md'
---

Looks a show up in the directories the installed podcast plugins can search

**`GET`** `/podcasts/search`

:::note
SDK method: `searchPodcastDirectory`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute | Type     | Required | Description                                                      |
| --------- | -------- | -------- | ---------------------------------------------------------------- |
| `query`   | `string` | Yes      | Words to look a show up by: its name, its publisher, its subject |
| `limit`   | `number` | No       |                                                                  |

</details>

## Response

`200 OK` — Returns a [StationDirectoryPage](../models/podcasts/station-directory-page.md) object.
