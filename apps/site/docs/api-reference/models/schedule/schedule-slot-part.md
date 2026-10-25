---
title: 'ScheduleSlotPart'
sidebar_position: 8
mdx:
    format: 'md'
---

> Where a slot that resumes its playlist will pick it up. Empty when it would start from the top: the slot does not resume, has no playlist, has aired nothing from it yet, or the last record it aired is no longer on it
> A part of a slot that applying it to the show on air can change, or has to leave for its next occurrence

```typescript
type ScheduleSlotPart = 'name' | 'brief' | 'era' | 'moods' | 'avoidMoods' | 'rules' | 'host' | 'coHosts' | 'source' | 'mode' | 'onEnd';
```
