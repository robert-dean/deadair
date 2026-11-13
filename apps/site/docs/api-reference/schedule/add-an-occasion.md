---
title: 'Add an occasion'
sidebar_label: 'Add an occasion'
sidebar_position: 7
mdx:
    format: 'md'
---

Adds an occasion at the end of the list. Presenters hear of it from the next break written for its day

**`POST`** `/occasions`

:::note
SDK method: `addAnOccasion`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [Occasion](../models/schedule/occasion.md) object.

## Response

`200 OK` — Returns a [OccasionList](../models/schedule/occasion-list.md) object.
