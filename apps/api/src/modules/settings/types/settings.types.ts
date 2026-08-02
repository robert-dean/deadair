import { z } from 'zod';

/**
 * generated from [MusicProviderKey](file://./../../../../data/contracts/settings/settings.types.ck#L7)
 */
export const MusicProviderKey = z.enum(['spotify', 'navidrome']);
export type MusicProviderKey = z.infer<typeof MusicProviderKey>;

/**
 * generated from [SpotifyMusicProvider](file://./../../../../data/contracts/settings/settings.types.ck#L9)
 */
export const SpotifyMusicProvider = z.strictObject({
    key: z.literal('spotify'),
    name: z.literal('Spotify'),
    redirectUri: z.url().describe("The exact OAuth redirect URI that's registered in the Spotify app"),
    clientId: z.string().min(1).max(256).describe('The client ID of the Spotify app'),
});
export type SpotifyMusicProvider = z.infer<typeof SpotifyMusicProvider>;

/**
 * generated from [NavidromeMusicProvider](file://./../../../../data/contracts/settings/settings.types.ck#L16)
 */
const NavidromeMusicProviderBase = z.strictObject({
    key: z.literal('navidrome'),
    name: z.literal('Navidrome'),
    url: z.url().describe('The URL of the Navidrome instance'),
    username: z.string().min(1).max(200).describe('The username of the Navidrome instance'),
    password: z.string().min(1).max(400).describe('The password of the Navidrome instance'),
});

export const NavidromeMusicProvider = z.strictObject({
    key: z.literal('navidrome'),
    name: z.literal('Navidrome'),
    url: z.url().describe('The URL of the Navidrome instance'),
    username: z.string().min(1).max(200).describe('The username of the Navidrome instance'),
});
export type NavidromeMusicProvider = z.infer<typeof NavidromeMusicProvider>;

export const NavidromeMusicProviderInput = z.strictObject({
    key: z.literal('navidrome'),
    name: z.literal('Navidrome'),
    url: z.url().describe('The URL of the Navidrome instance'),
    username: z.string().min(1).max(200).describe('The username of the Navidrome instance'),
    password: z.string().min(1).max(400).describe('The password of the Navidrome instance'),
});
export type NavidromeMusicProviderInput = z.infer<typeof NavidromeMusicProviderInput>;

/**
 * generated from [MusicProvider](file://./../../../../data/contracts/settings/settings.types.ck#L24)
 */
export const MusicProvider = z.discriminatedUnion('key', [SpotifyMusicProvider, NavidromeMusicProvider]);
export type MusicProvider = z.infer<typeof MusicProvider>;
export const MusicProviderInput = z.discriminatedUnion('key', [SpotifyMusicProvider, NavidromeMusicProviderInput]);
export type MusicProviderInput = z.infer<typeof MusicProviderInput>;
