---
title: 'NowPlayingShow'
sidebar_position: 3
mdx:
    format: 'md'
---

> The programme on air, as a listener would be told it

<details>
<summary>Attributes (2)</summary>

| Attribute | Type     | Required | Description                                                                                                                                                                                                     |
| --------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`    | `string` | Yes      | What this broadcast is called. It changes the moment the station changes programme, which can be one record before the new programme's first record is heard: a changeover never cuts a listener off mid-record |
| `host`    | `string` | No       | Who is presenting, by the name they go by on air. Absent when there is no name to give: no persona on air with one, and no station-wide presenter name set. Never the persona's console label                   |

</details>
