---
title: 'SpeechPreviewRequest'
sidebar_position: 16
mdx:
    format: 'md'
---

> Words to hear before anything has aired them

<details>
<summary>Attributes (2)</summary>

| Attribute | Type     | Required | Description                                                                                                                                     |
| --------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`    | `string` | Yes      | What to say. Far under a segment's 20000 because this is one break heard once, and the cap is what bounds a cache keyed on the words themselves |
| `voice`   | `string` | No       | A station voice name, as a segment's `voice`. Absent uses the plugin's own default                                                              |

</details>
