---
title: 'GeneratedPersona'
sidebar_position: 5
mdx:
    format: 'md'
---

> What a model wrote, and what had to be dropped to make it usable

<details>
<summary>Attributes (4)</summary>

| Attribute          | Type                  | Required | Description                                                                                                                                                                                                                                                                       |
| ------------------ | --------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `persona`          | `PersonaDraftView`    | Yes      |                                                                                                                                                                                                                                                                                   |
| `stories`          | `PersonaStoryWrite[]` | Yes      | A couple of things that have happened to this character. Beside the form rather than in it, because they are their own table: the console saves the persona and then writes these through the stories route, so they go through the same validation an operator's own typing does |
| `droppedMarkers`   | `string[]`            | Yes      | Words the model called markers that its own sample lines never used. Dropped, because the samples are the evidence and the marker list is the claim — a marker nothing says declines every break and looks exactly like a model that is switched off                              |
| `droppedTemplates` | `string[]`            | Yes      | Phrasings naming a value the vocabulary does not have. Dropped by the LINE, since five good phrasings and one broken one is five phrasings                                                                                                                                        |

</details>
