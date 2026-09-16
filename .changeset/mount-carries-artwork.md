---
'@deadair/api': patch
---

The mount carries artwork as well as a title. Every ICY update now fills the `StreamUrl` field beside `StreamTitle`: a record's cover, made absolute against the station's public URL, or the station's own logo for a break, the bed and off air, so a player that reads the field never shows the previous record's cover under the wrong caption. Nothing is sent without a public URL. `stream/streamurl.check.py` measures whether a given player draws it, against a throwaway mount rather than the station's.
