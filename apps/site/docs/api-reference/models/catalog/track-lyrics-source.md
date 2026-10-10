---
title: 'TrackLyricsSource'
sidebar_position: 14
mdx:
    format: 'md'
---

> One lyrics source's answer for one record. A source that was asked and had nothing is not listed.

<details>
<summary>Attributes (7)</summary>

| Attribute      | Type                | Required | Description                                                                    |
| -------------- | ------------------- | -------- | ------------------------------------------------------------------------------ |
| `provider`     | `string`            | Yes      | The plugin that answered. _read-only_                                          |
| `providerRef`  | `string`            | No       | The source's own id for what it matched. _read-only_                           |
| `plain`        | `string`            | No       | _read-only_                                                                    |
| `synced`       | `LyricLineDetail[]` | No       | _read-only_                                                                    |
| `language`     | `string`            | No       | _read-only_                                                                    |
| `instrumental` | `boolean`           | Yes      | The source says nobody sings on this record, so it holds no words. _read-only_ |
| `fetchedAt`    | `string`            | Yes      | _read-only_                                                                    |

</details>
