---
title: 'NewsQuery'
sidebar_position: 4
mdx:
    format: 'md'
---

<details>
<summary>Attributes (4)</summary>

| Attribute       | Type      | Required | Description                                                                                                                                                                                                                          |
| --------------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `feedId`        | `string`  | No       | One feed, or absent for every feed the station can see, merged newest first                                                                                                                                                          |
| `limit`         | `number`  | No       |                                                                                                                                                                                                                                      |
| `since`         | `string`  | No       | Only entries published after this ISO-8601 instant                                                                                                                                                                                   |
| `headlinesOnly` | `boolean` | No       | Answer with headlines and teasers alone, skipping the story behind each one. A story is read from the publisher's own page, which is by far the slowest thing this route does, so a caller that will not use `content` should say so |

</details>
