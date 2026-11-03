---
title: 'List occasions'
sidebar_label: 'List occasions'
sidebar_position: 1
mdx:
    format: 'md'
---

Every occasion on this station, in the order a date is matched against them, each saying when it next falls

**`GET`** `/occasions`

:::note
SDK method: `listOccasions`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [OccasionList](../models/schedule/occasion-list.md) object.
