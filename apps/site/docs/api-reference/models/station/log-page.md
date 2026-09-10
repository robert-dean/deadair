---
title: 'LogPage'
sidebar_position: 5
mdx:
    format: 'md'
---

<details>
<summary>Attributes (4)</summary>

| Attribute   | Type        | Required | Description                                                                                                                                   |
| ----------- | ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceId`  | `string`    | Yes      |                                                                                                                                               |
| `level`     | `LogLevel`  | No       | The minimum severity that was applied. Absent when the source carries no levels, so a filter that did nothing cannot look as though it worked |
| `truncated` | `boolean`   | Yes      | Whether the read hit its byte budget, so the oldest line here is not the file's first                                                         |
| `lines`     | `LogLine[]` | Yes      | Newest first, as the plugin log page, the activity feed and the script history all send                                                       |

</details>
