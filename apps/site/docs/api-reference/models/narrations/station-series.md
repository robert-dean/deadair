---
title: 'StationSeries'
sidebar_position: 1
mdx:
    format: 'md'
---

> Something the station can read out, as one installed plugin describes it

<details>
<summary>Attributes (9)</summary>

| Attribute     | Type                   | Required | Description                                                                                                               |
| ------------- | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `string`               | Yes      | Unique across the station: the plugin's own id for the series, qualified with the plugin that offered it                  |
| `pluginId`    | `string`               | Yes      |                                                                                                                           |
| `title`       | `string`               | Yes      | What the series is called, which is what a presenter says out loud                                                        |
| `order`       | `'serial' \| 'latest'` | Yes      | How it is worked through: `serial` from the beginning in order, `latest` its newest piece and nothing once that has aired |
| `author`      | `string`               | No       |                                                                                                                           |
| `description` | `string`               | No       | What the series says about itself, as plain text                                                                          |
| `artworkUrl`  | `string`               | No       |                                                                                                                           |
| `homeUrl`     | `string`               | No       |                                                                                                                           |
| `language`    | `string`               | No       | ISO 639-1, or the source's own tag. Also what the station splits sentences by when it cuts a long piece up                |

</details>
