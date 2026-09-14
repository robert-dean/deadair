import { DeadairSdk, SdkError, type NowPlaying } from '@deadair/sdk';

// The station's API root, and a token for the routes that need one. What is on air is the one public
// route, so the token is optional and only the history needs it.
const baseUrl = process.argv[2] ?? process.env['DEADAIR_URL'] ?? 'http://localhost:8080/api';
const token = process.env['DEADAIR_TOKEN'];

const sdk = new DeadairSdk({
    baseUrl,
    headers: (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {}),
});

function describe(now: NowPlaying): string {
    if (!now.onAir || !now.track) {
        return 'off air';
    }
    if (now.track.kind === 'break') {
        return `talking: ${now.track.title}`;
    }
    const host = now.show?.host ? ` with ${now.show.host}` : '';
    return `${now.track.artist} - ${now.track.title}${host}, to ${now.listeners} listening`;
}

const now = await sdk.nowplaying.getNowPlaying();
console.log(`${now.station}: ${describe(now)}`);

if (!token) {
    console.log('Set DEADAIR_TOKEN to an access token to see what played before this.');
} else {
    try {
        const page = await sdk.history.readHistory({ limit: 5 });
        for (const entry of page.entries) {
            console.log(`  ${entry.airedAt.toRelative() ?? entry.airedAt.toISO()}  ${entry.artists} - ${entry.title}`);
        }
    } catch (error) {
        if (error instanceof SdkError && (error.status === 401 || error.status === 403)) {
            console.log(`The station refused the token for the history (${error.status}).`);
        } else {
            throw error;
        }
    }
}
