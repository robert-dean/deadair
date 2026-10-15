---
title: 'InvitationPreview'
sidebar_position: 8
mdx:
    format: 'md'
---

> An invitation as it would be emailed now, with a sample link, inviter and date in place of a real one

<details>
<summary>Attributes (5)</summary>

| Attribute    | Type      | Required | Description                                                                                                                                                             |
| ------------ | --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subject`    | `string`  | Yes      | The subject line                                                                                                                                                        |
| `html`       | `string`  | Yes      | The whole HTML part, as a document                                                                                                                                      |
| `text`       | `string`  | Yes      | The plain-text part                                                                                                                                                     |
| `ownWording` | `boolean` | Yes      | Whether the station's saved subject or message was used. False when neither is set, or when what is saved cannot be used and the station's own wording is shown instead |
| `problem`    | `string`  | No       | Why the saved wording cannot be used, in a sentence. Absent when it can, or when nothing is saved                                                                       |

</details>
