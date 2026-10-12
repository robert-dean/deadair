---
title: 'OwnEpisodeRequest'
sidebar_position: 11
mdx:
    format: 'md'
---

> Asks one of the station's own shows for an episode. Everything is optional: a show with a standing subject needs nothing

<details>
<summary>Attributes (4)</summary>

| Attribute     | Type     | Required | Description                                                                      |
| ------------- | -------- | -------- | -------------------------------------------------------------------------------- |
| `topic`       | `string` | No       | What this episode is about. Absent is the show's own subject                     |
| `sourceTitle` | `string` | No       | What the pasted text is called                                                   |
| `text`        | `string` | No       | Something for it to read first. The episode states only what it can find in this |
| `airAt`       | `string` | No       | When it should air. Absent is as soon as it is made                              |

</details>
