---
title: 'MixBranch'
sidebar_position: 9
mdx:
    format: 'md'
---

> One output of a `split`

<details>
<summary>Attributes (3)</summary>

| Attribute | Type       | Required | Description                                                                                                                                                                  |
| --------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `values`  | `string[]` | No       | What it matches, for `genre`, `lastGenre` (a genre or anything refining it), `artist`, `judged` (`yes` or `no`) and `energy` (`low`, `medium` or `high`); a decade as `1980` |
| `min`     | `number`   | No       | The lowest it matches, for `hour` and `showProgress`, inclusive                                                                                                              |
| `max`     | `number`   | No       | The highest, exclusive                                                                                                                                                       |

</details>
