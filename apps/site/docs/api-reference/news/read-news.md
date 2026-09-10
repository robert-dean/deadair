---
title: 'Read news'
sidebar_label: 'Read news'
sidebar_position: 2
mdx:
    format: 'md'
---

Published entries, newest first

**`GET`** `/news`

:::note
SDK method: `readNews`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (4)</summary>

| Attribute       | Type      | Required | Description                                                                                                                                                                                                                          |
| --------------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `feedId`        | `string`  | No       | One feed, or absent for every feed the station can see, merged newest first                                                                                                                                                          |
| `headlinesOnly` | `boolean` | No       | Answer with headlines and teasers alone, skipping the story behind each one. A story is read from the publisher's own page, which is by far the slowest thing this route does, so a caller that will not use `content` should say so |
| `limit`         | `number`  | No       |                                                                                                                                                                                                                                      |
| `since`         | `string`  | No       | Only entries published after this ISO-8601 instant                                                                                                                                                                                   |

</details>

## Response

`200 OK` — Returns a [NewsPage](../models/news/news-page.md) object.
