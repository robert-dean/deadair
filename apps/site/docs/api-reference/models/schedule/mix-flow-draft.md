---
title: 'MixFlowDraft'
sidebar_position: 13
mdx:
    format: 'md'
---

> A mix flow the station's model drafted from a brief, and what it made of each phrase. Nothing is saved: the operator looks it over on the canvas and saves it with the show as usual

<details>
<summary>Attributes (3)</summary>

| Attribute  | Type                | Required | Description                                                                           |
| ---------- | ------------------- | -------- | ------------------------------------------------------------------------------------- |
| `flow`     | `MixFlow`           | Yes      | The drafted flow, laid out for the canvas. It passes the same check a saved flow does |
| `readings` | `MixDraftReading[]` | Yes      | Each phrase of the brief the model read, and what became of it                        |
| `model`    | `string`            | No       | The model that drafted it                                                             |

</details>
