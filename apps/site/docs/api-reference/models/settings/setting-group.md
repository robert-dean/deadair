---
title: 'SettingGroup'
sidebar_position: 1
mdx:
    format: 'md'
---

> Which part of the console owns a setting. Every one of these but `schedule` and `personas` is a section of the settings page; `schedule` is edited on the schedule page, beside the timetable it describes, and `personas` on the characters page, beside the names it stands behind.

```typescript
type SettingGroup =
    'station' | 'stream' | 'housekeeping' | 'secrets' | 'mail' | 'rotation' | 'playout' | 'render' | 'llm' | 'analysis' | 'schedule' | 'personas';
```
