---
'@deadair/api': patch
---

The mount carries artwork as well as a title. Every ICY update now fills the `StreamUrl` field beside `StreamTitle`: a record's cover, made absolute against the station's public URL, or the station's own logo for a break, the bed and off air, so a player that reads the field never shows the previous record's cover under the wrong caption. The public URL is derived from the console address the station was deployed with (`SPA_BASE_URL`) when the setting is empty, which also gives Icecast a real advertised hostname on a station that never filled it in. `stream/streamurl.check.py` measures whether a given player draws the field, against a throwaway mount rather than the station's; an NAD M10 V2 on BluOS 4.16.22 does, per record, with no reconnect.
