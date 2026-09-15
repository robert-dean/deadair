---
title: 'StationShow'
sidebar_position: 1
mdx:
    format: 'md'
---

> A programme the station carries, as one installed plugin describes it

<details>
<summary>Attributes (11)</summary>

| Attribute     | Type       | Required | Description                                                                                                                  |
| ------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `string`   | Yes      | Unique across the station: the plugin's own id for the show, qualified with the plugin that offered it                       |
| `pluginId`    | `string`   | Yes      |                                                                                                                              |
| `title`       | `string`   | Yes      | What the show is called, which is what a presenter says out loud                                                             |
| `author`      | `string`   | No       |                                                                                                                              |
| `description` | `string`   | No       | What the show says about itself, as plain text                                                                               |
| `artworkUrl`  | `string`   | No       |                                                                                                                              |
| `homeUrl`     | `string`   | No       |                                                                                                                              |
| `feedUrl`     | `string`   | No       | Where its feed is, when the plugin reads one                                                                                 |
| `language`    | `string`   | No       |                                                                                                                              |
| `categories`  | `string[]` | No       |                                                                                                                              |
| `explicit`    | `boolean`  | No       | Whether the publisher marked the whole show explicit. Absent means the publisher did not say, which is not the same as clean |

</details>
