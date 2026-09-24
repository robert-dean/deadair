/** The library destination: its heading and the tabs under it. */
export const library = {
    title: 'Library',
    tabs: {
        tracks: { label: 'Tracks', hint: 'Every record the station has ingested' },
        artists: { label: 'Artists', hint: 'Who the records are by' },
        playlists: { label: 'Playlists', hint: 'What a music plugin can offer it' },
        charts: { label: 'Charts', hint: 'What is doing well elsewhere' },
        news: { label: 'News', hint: 'The stories a bulletin is written from' },
        podcasts: { label: 'Podcasts', hint: "Somebody else's programmes the station can carry" },
        narrations: { label: 'Readings', hint: 'Books and columns the station reads out itself' },
    },
} as const;
