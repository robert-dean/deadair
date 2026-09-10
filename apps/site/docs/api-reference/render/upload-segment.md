---
title: 'Upload segment'
sidebar_label: 'Upload segment'
sidebar_position: 3
mdx:
    format: 'md'
---

Takes a recording in from the browser and puts it in the library, ready to air

**`POST`** `/segments/upload`

:::note
SDK method: `uploadSegment`
Security: authenticated (policy: platform.manage)
:::

## Request body (`multipart/form-data`)

Accepts a [SegmentUpload](../models/render/segment-upload.md) object.

## Response

`201 Created` — Returns a [Segment](../models/render/segment.md) object.

`400 Bad Request`

`413`

`415`
