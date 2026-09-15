import streamDeck from '@elgato/streamdeck';

// The actions register here once they exist; until then the plugin connects and does nothing, which
// is enough for the Stream Deck app to list it and for `streamdeck validate` to check the manifest.
streamDeck.logger.setLevel('info');
await streamDeck.connect();
