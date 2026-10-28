---
title: 'PronunciationSampleRequest'
sidebar_position: 27
mdx:
    format: 'md'
---

> One entry to hear, whether or not the lexicon holds it yet

<details>
<summary>Attributes (3)</summary>

| Attribute | Type     | Required | Description                                                                                                   |
| --------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `written` | `string` | Yes      | What is spoken, with this entry applied to it                                                                 |
| `spoken`  | `string` | Yes      | How this entry says it. Not empty, unlike a stored entry's: an entry that drops the words has nothing to hear |
| `voice`   | `string` | No       | A station voice name. Absent uses the plugin's own default                                                    |

</details>
