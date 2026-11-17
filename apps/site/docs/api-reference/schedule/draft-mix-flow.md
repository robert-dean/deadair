---
title: 'Draft mix flow'
sidebar_label: 'Draft mix flow'
sidebar_position: 21
mdx:
    format: 'md'
---

Drafts a show's mix flow from its brief with the station's model: blocks, limits, required records and judge questions, each drawn from a phrase, and the phrases about taste left to the picks. Writes nothing

**`POST`** `/schedule/mix-draft`

:::note
SDK method: `draftMixFlow`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [MixFlowDraftRequest](../models/schedule/mix-flow-draft-request.md) object.

## Response

`200 OK` — Returns a [MixFlowDraft](../models/schedule/mix-flow-draft.md) object.

`502`

`503`
