---
title: 'MeasureFailure'
sidebar_position: 8
mdx:
    format: 'md'
---

> Why a measurement failed, as the station retries it.
>
> unfetchable the bytes could not be fetched: a provider was down or a link expired. Tried again within the hour
> truncated the fetch stopped part of the way through. Tried again within the hour
> undecodable the file itself would not decode. Tried again after a day, since retrying sooner is the same bytes again
>
> A failure recorded before the station kept the kind reads as `undecodable`, because that is the clock it is retried on.

```typescript
type MeasureFailure = 'unfetchable' | 'undecodable' | 'truncated';
```
