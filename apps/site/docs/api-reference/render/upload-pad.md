---
title: 'Upload pad'
sidebar_label: 'Upload pad'
sidebar_position: 21
mdx:
    format: 'md'
---

Takes a sound in from the browser and puts it on a board. The file lands in the pad library on disk, so it survives a rebuild and an archive carries it

**`POST`** `/pads`

:::note
SDK method: `uploadPad`
Security: authenticated (policy: platform.manage)
:::

## Request body (`multipart/form-data`)

Accepts a [PadUpload](../models/render/pad-upload.md) object.

## Response

`200 OK` — Returns a [PadList](../models/render/pad-list.md) object.

`400 Bad Request`

`409 Conflict`

`413`

`415`
