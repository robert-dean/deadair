---
title: 'PersonaQuirk'
sidebar_position: 2
mdx:
    format: 'md'
---

> One thing a character does on air, and how often it does it

<details>
<summary>Attributes (2)</summary>

| Attribute | Type                                                | Required | Description                                                                                                                                                                                                                                                            |
| --------- | --------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`    | `string`                                            | Yes      |                                                                                                                                                                                                                                                                        |
| `cadence` | `'always' \| 'often' \| 'occasionally' \| 'rarely'` | No       | How often it applies. Absent is `always`: a rule, sent on every break. The others are something the character does now and then, and the station picks which ordinary talk breaks, at most one such quirk to a break, so the text should not say "now and then" itself |

</details>
