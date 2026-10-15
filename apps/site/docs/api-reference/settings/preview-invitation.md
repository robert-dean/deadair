---
title: 'Preview invitation'
sidebar_label: 'Preview invitation'
sidebar_position: 4
mdx:
    format: 'md'
---

Renders the invitation email as it would be sent now, in the station's saved wording, with sample values in place of a real link, inviter and date

**`GET`** `/settings/mail/invitation/preview`

:::note
SDK method: `previewInvitation`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type                    | Required | Description                                                                                                            |
| --------- | ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `role`    | `'listener' \| 'admin'` | Yes      | The role the invitation would be for. Its subject, its guide link and the station's own wording differ between the two |

</details>

## Response

`200 OK` — Returns a [InvitationPreview](../models/settings/invitation-preview.md) object.
