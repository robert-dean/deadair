---
title: 'SpeechPreviewRequest'
sidebar_position: 16
mdx:
    format: 'md'
---

> Words to hear before anything has aired them

<details>
<summary>Attributes (4)</summary>

| Attribute    | Type     | Required | Description                                                                                                                                                                         |
| ------------ | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`       | `string` | Yes      | What to say. Far under a segment's 20000 because this is one break heard once, and the cap is what bounds a cache keyed on the words themselves                                     |
| `voice`      | `string` | No       | A station voice name, as a segment's `voice`. Absent uses the plugin's own default                                                                                                  |
| `delivery`   | `string` | No       | How to read it, as a segment's `delivery`: `hushed` or `frantic`, and refused otherwise. Absent is the voice's own ordinary reading                                                 |
| `soundboard` | `string` | No       | The board a `[sfx:name]` in the text is played from, as a character's `soundboard`. Absent, or a hit the board does not hold, and the hit is left out and only the words are spoken |

</details>
