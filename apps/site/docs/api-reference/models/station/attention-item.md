---
title: 'AttentionItem'
sidebar_position: 8
mdx:
    format: 'md'
---

> One thing that wants the operator's attention, or the fact that nothing does

<details>
<summary>Attributes (8)</summary>

| Attribute     | Type                                 | Required | Description                                                                                                                                                                                                                             |
| ------------- | ------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`        | `string`                             | Yes      | What this is, as a stable key: `silence`, `benchedCopies`, `noPersona`. The console groups and counts on it rather than on the sentence                                                                                                 |
| `severity`    | `'failure' \| 'warning' \| 'notice'` | Yes      | `failure` is the station not doing its job, `warning` is something failing beside a station that is working, and `notice` is a thing nobody has set up yet. A notice is not a fault and must not be drawn as one                        |
| `title`       | `string`                             | Yes      | The line an operator reads first                                                                                                                                                                                                        |
| `detail`      | `string`                             | Yes      | The whole of it, in a sentence. Where the station already has words for a fact, these are those words rather than a second phrasing of them                                                                                             |
| `route`       | `string`                             | Yes      | The console page that can do something about it                                                                                                                                                                                         |
| `count`       | `number`                             | No       | How many things this is about, where that is a number rather than a state                                                                                                                                                               |
| `dismissible` | `boolean`                            | No       | The operator may accept this row as it stands, through `POST /station/attention/{code}/dismiss`. It comes back by itself when something new joins it. Absent on a row that only goes away when its cause does                           |
| `evidence`    | `AttentionEvidence[]`                | No       | A HANDFUL of the things this row is about, never all of them: this answer is polled and a row about four hundred records must not be four hundred sentences. `count` stays the true figure, and a console showing fewer than it says so |

</details>
