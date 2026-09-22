---
title: 'SettingGroup'
sidebar_position: 1
mdx:
    format: 'md'
---

> Which part of the console owns a setting. Every one of these but `schedule`, `personas`, `phrasings` and `providers` is a section of the settings page; `schedule` is edited on the schedule page, beside the timetable it describes, `personas` on the characters page, beside the names it stands behind, `phrasings` on the Voice page's Phrasings tab, beside everything else about what the station says, and `providers` on the Providers section, which draws each capability beside the plugins that answer it rather than as a form of text fields.

```typescript
type SettingGroup =
    | 'station'
    | 'stream'
    | 'housekeeping'
    | 'mail'
    | 'rotation'
    | 'breaks'
    | 'bulletins'
    | 'playout'
    | 'render'
    | 'llm'
    | 'analysis'
    | 'schedule'
    | 'personas'
    | 'phrasings'
    | 'providers';
```
