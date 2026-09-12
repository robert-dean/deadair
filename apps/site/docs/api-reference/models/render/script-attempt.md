---
title: 'ScriptAttempt'
sidebar_position: 11
mdx:
    format: 'md'
---

> One attempt to write something the station would say, including the ones that came to nothing

<details>
<summary>Attributes (20)</summary>

| Attribute    | Type                    | Required | Description                                                                                                                                                                                                                                                     |
| ------------ | ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | `string`                | Yes      |                                                                                                                                                                                                                                                                 |
| `at`         | `string`                | Yes      |                                                                                                                                                                                                                                                                 |
| `kind`       | `string`                | Yes      | What sort of break it was for: `talkbreak`, `welcome`, `news`                                                                                                                                                                                                   |
| `writer`     | `string`                | Yes      | The binding that produced or declined it                                                                                                                                                                                                                        |
| `outcome`    | `ScriptOutcome`         | Yes      |                                                                                                                                                                                                                                                                 |
| `personaKey` | `string`                | No       | Who was presenting, as the persona's own key. Absent means nobody was, which is an ordinary state. Stamped on every attempt including the declined ones, so a character whose model breaks are all being refused is visible rather than hidden behind the floor |
| `label`      | `string`                | No       |                                                                                                                                                                                                                                                                 |
| `script`     | `string`                | No       | The words. Absent for an attempt that produced none                                                                                                                                                                                                             |
| `delivery`   | `string`                | No       | How the writer chose to have the words read, `hushed` or `frantic`. Absent for an ordinary reading                                                                                                                                                              |
| `model`      | `string`                | No       | The model that said it, for a writer that used one                                                                                                                                                                                                              |
| `source`     | `string`                | No       | What the line was rendered from, for a writer working from something an operator can edit                                                                                                                                                                       |
| `reason`     | `string`                | No       | Why, for anything that is not `written`                                                                                                                                                                                                                         |
| `segmentId`  | `string`                | No       | The segment this was for, while it is still known. The row outlives it                                                                                                                                                                                          |
| `previous`   | `ScriptNeighbour`       | No       |                                                                                                                                                                                                                                                                 |
| `next`       | `ScriptNeighbour`       | No       |                                                                                                                                                                                                                                                                 |
| `durationMs` | `number`                | No       | How long the attempt took                                                                                                                                                                                                                                       |
| `usage`      | `ScriptUsage`           | No       |                                                                                                                                                                                                                                                                 |
| `raw`        | `string`                | No       | The answer before anything read it. Only while `llm.captureWrites` is on                                                                                                                                                                                        |
| `prompt`     | `ScriptPromptMessage[]` | No       | What the writer sent. Only while `llm.captureWrites` is on                                                                                                                                                                                                      |
| `rating`     | `ScriptRating`          | No       | What the operator thought of it. ABSENT means nobody has said, which `neutral` does not. _read-only_                                                                                                                                                            |

</details>
