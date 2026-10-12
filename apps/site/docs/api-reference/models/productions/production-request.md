---
title: 'ProductionRequest'
sidebar_position: 5
mdx:
    format: 'md'
---

> What an operator asks for. Everything else about a production is decided by the passes that make it

<details>
<summary>Attributes (10)</summary>

| Attribute      | Type                                  | Required | Description                                                                                                                                                                             |
| -------------- | ------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`         | `string`                              | No       |                                                                                                                                                                                         |
| `title`        | `string`                              | No       | Absent is named after its kind and the moment it was asked for, which is what somebody taking a call now wants rather than a box to fill in                                             |
| `brief`        | `string`                              | No       |                                                                                                                                                                                         |
| `notes`        | `string[]`                            | No       | What it may state as fact, one short note each. Absent leaves it to general knowledge, said vaguely                                                                                     |
| `sources`      | `ProductionSource[]`                  | No       | What to read before writing it. Given sources and no notes, a research pass takes the notes out of these first                                                                          |
| `research`     | `boolean`                             | No       | Given nothing to read, search the operator's trusted sites for its subject and read what comes back. Needs an enrichment plugin that can, such as the web search one with trusted sites |
| `personaId`    | `string`                              | No       |                                                                                                                                                                                         |
| `writingMode`  | `'quick' \| 'outlined' \| 'polished'` | No       | Absent takes the station's `render.productionWritingMode`                                                                                                                               |
| `targetMs`     | `number`                              | No       |                                                                                                                                                                                         |
| `scheduledFor` | `string`                              | No       |                                                                                                                                                                                         |

</details>
