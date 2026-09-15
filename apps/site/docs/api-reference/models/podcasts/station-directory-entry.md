---
title: 'StationDirectoryEntry'
sidebar_position: 4
mdx:
    format: 'md'
---

> A show a podcast plugin's directory knows about, which the station may or may not carry

<details>
<summary>Attributes (10)</summary>

| Attribute     | Type       | Required | Description                                                                         |
| ------------- | ---------- | -------- | ----------------------------------------------------------------------------------- |
| `id`          | `string`   | Yes      | The directory's own id for the show. A key in a list, and nothing more              |
| `pluginId`    | `string`   | Yes      | The plugin whose directory answered, which is the plugin a subscription would go to |
| `title`       | `string`   | Yes      |                                                                                     |
| `feedUrl`     | `string`   | Yes      | Where the show's feed is, which is what subscribing needs                           |
| `author`      | `string`   | No       |                                                                                     |
| `description` | `string`   | No       |                                                                                     |
| `artworkUrl`  | `string`   | No       |                                                                                     |
| `homeUrl`     | `string`   | No       |                                                                                     |
| `categories`  | `string[]` | No       |                                                                                     |
| `explicit`    | `boolean`  | No       |                                                                                     |

</details>
