---
'@deadair/api': patch
---

The audio chain now checks a skip against what is actually playing. The app sends the id of the record it means to cut, and the audio chain cuts only if that record is still the one on air. That closes the last gap, where a record could end during the moment the skip was travelling to the audio chain.
