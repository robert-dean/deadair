---
title: 'ProductionSource'
sidebar_position: 2
mdx:
    format: 'md'
---

> Something a production was handed to read. The research pass takes the notes it states as fact out of these, keeping only claims whose words really are in the text

<details>
<summary>Attributes (3)</summary>

| Attribute | Type     | Required | Description                                                                                                                                   |
| --------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`   | `string` | Yes      | What the source is called, for the console and for the research pass's sense of what it is reading                                            |
| `url`     | `string` | No       | Where it came from, when it came from somewhere                                                                                               |
| `text`    | `string` | No       | What it says. Absent for a source given only by its address, which the research pass reads through whichever installed plugin can open a page |

</details>
