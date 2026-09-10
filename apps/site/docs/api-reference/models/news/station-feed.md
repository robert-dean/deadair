---
title: 'StationFeed'
sidebar_position: 1
mdx:
    format: 'md'
---

> A feed one installed plugin offers

<details>
<summary>Attributes (6)</summary>

| Attribute     | Type     | Required | Description                                                                                                                                                       |
| ------------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `string` | Yes      | Unique across the station: the plugin's own id for the feed, qualified with the plugin that offered it. Two services both calling something `world` stay distinct |
| `pluginId`    | `string` | Yes      |                                                                                                                                                                   |
| `name`        | `string` | Yes      |                                                                                                                                                                   |
| `category`    | `string` | No       | Broad subject, in the publisher's own word for it                                                                                                                 |
| `language`    | `string` | No       | ISO 639-1, when the plugin knows                                                                                                                                  |
| `description` | `string` | No       |                                                                                                                                                                   |

</details>
