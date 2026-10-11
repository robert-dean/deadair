---
'@deadair/api': patch
---

The station's library search now matches whole words, so the model's search for an artist or a style no longer turns up records that only contain the search inside another word. Searching for Dio used to answer with every "Radio Edit", "Audio Remix", Diopter and Dior in the library; it now answers with Dio. A style still finds the longer styles it is part of, so metal finds heavy metal. Searching for part of a word, such as "Metalli", no longer finds anything. The console's catalog filters and the listener request search are unchanged.
