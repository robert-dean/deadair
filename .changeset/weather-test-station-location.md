---
'@deadair/api': patch
---

Testing a weather plugin now also looks up the station's own location through it and says what it found, so a station in Leeds sees "Leeds, England" rather than only the fixed test lookup for Atlanta. A place the service cannot find is reported there too, which is what a US-only service does with anywhere outside the United States.
