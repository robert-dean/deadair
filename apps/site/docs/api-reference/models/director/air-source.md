---
title: 'AirSource'
sidebar_position: 6
mdx:
    format: 'md'
---

> Who chose what is on air. `schedule` is a block the clock changed over to and `sustaining` is what it plays in the hours no block claims — both are the schedule driving. `operator` is a person, including one who took over inside a scheduled block, and it holds until the next block begins. `off` is a station stood down

```typescript
type AirSource = 'off' | 'schedule' | 'sustaining' | 'operator';
```
