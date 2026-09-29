---
'@deadair/api': patch
---

A restart no longer replays the record that was on air before it. The running order was saved only when the station lined up a new record, so a record that started while the next one was still downloading stayed saved as waiting to play, and the next boot queued it again. It aired twice inside the repeat window, as the first record after the restart. The order is now saved within two seconds of every record going on air.
