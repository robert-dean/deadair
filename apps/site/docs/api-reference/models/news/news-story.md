---
title: 'NewsStory'
sidebar_position: 3
mdx:
    format: 'md'
---

> One published entry

<details>
<summary>Attributes (9)</summary>

| Attribute     | Type       | Required | Description                                                                                                                                                                                |
| ------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`          | `string`   | Yes      | Stable for the same entry across calls, which is what lets a reader tell an arrival from something it has already seen                                                                     |
| `feedId`      | `string`   | Yes      | Qualified, matching `StationFeed.id`                                                                                                                                                       |
| `feedName`    | `string`   | Yes      |                                                                                                                                                                                            |
| `title`       | `string`   | Yes      |                                                                                                                                                                                            |
| `summary`     | `string`   | No       | The publisher's own teaser, as plain text. Never markup: this is written to be read out                                                                                                    |
| `content`     | `string`   | No       | The story itself, as the publisher's own paragraphs. Absent when the plugin could not read one, which is ordinary: an entry that links to audio, or a page nothing could be extracted from |
| `url`         | `string`   | No       |                                                                                                                                                                                            |
| `publishedAt` | `string`   | No       | ISO-8601                                                                                                                                                                                   |
| `categories`  | `string[]` | No       |                                                                                                                                                                                            |

</details>
