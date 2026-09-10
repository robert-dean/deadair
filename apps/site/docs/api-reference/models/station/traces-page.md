---
title: 'TracesPage'
sidebar_position: 17
mdx:
    format: 'md'
---

<details>
<summary>Attributes (3)</summary>

| Attribute   | Type              | Required | Description                                                                       |
| ----------- | ----------------- | -------- | --------------------------------------------------------------------------------- |
| `decisions` | `TraceDecision[]` | Yes      | Newest first                                                                      |
| `total`     | `number`          | Yes      | How many the window holds before `limit`, so a page can say it is showing a slice |
| `spans`     | `number`          | Yes      | How many calls were read to answer, which is the honest cost of this page         |

</details>
