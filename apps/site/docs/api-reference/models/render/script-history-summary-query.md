---
title: 'ScriptHistorySummaryQuery'
sidebar_position: 17
mdx:
    format: 'md'
---

> The window the counts cover

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description                                                                                                                                                                                                 |
| --------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hours`   | `number` | No       | How far back to count. Defaults to 24, and a week at most, because past that the nightly sweep may already have taken the rows and the count would quietly be of what survived rather than of what happened |

</details>
