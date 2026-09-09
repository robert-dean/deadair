import { resolve } from 'node:path';

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

// The dev API port: PORT in apps/api/.env. nginx.dev.conf proxies :8080 to the same host port.
const API_TARGET = 'http://127.0.0.1:3333';

// Icecast, on the port docker-compose publishes to the host.
const ICECAST_TARGET = 'http://127.0.0.1:8000';

/**
 * The Icecast mounts, for the console's stream monitor.
 *
 * A REGEX rather than a path, which is what a `^`-prefixed proxy key means to
 * Vite. The station's real mount is the `stream.mount` setting (the API reports it
 * as `PlayoutStatus.mountPath`) and it can publish up to four of them — MP3 always,
 * plus Opus, AAC and FLAC as the operator switches them on, their paths derived
 * from `stream.mount` by swapping the extension. A dev proxy cannot read the
 * database, so matching the shape rather than the value is what stops this being a
 * hand-coupled copy of a setting that has to be edited alongside it.
 *
 * The same expression, and the same reasoning, as `nginx/snippets/icecast.conf`.
 * Keep the two in step: this is the edge when the SPA is opened on :3002 directly,
 * and that one is the edge when it is opened through nginx on :8080.
 */
const MOUNT_PATTERN = '^/[^/]+\\.(mp3|opus|aac|flac)$';

export default defineConfig(({ mode }) => ({
    plugins: [
        // Must precede react() so the generated route tree is in place before JSX transforms.
        tanstackRouter({ target: 'react', autoCodeSplitting: true }),
        react(),
    ],
    server: {
        // nginx.dev.conf proxies http://localhost:8080/ to this port.
        port: 3002,
        strictPort: true,
        // The default binds ::1 only, which the dev nginx container cannot reach over
        // host.docker.internal (that resolves to the host's IPv4 address).
        host: true,
        // Vite rejects any Host header it was not told about, so a tunnel that forwards
        // the public hostname through gets a 403 before any route or proxy is consulted.
        // The hostname is one developer's arrangement rather than the project's, so it comes
        // from the environment: put `VITE_ALLOWED_HOSTS=radio.example.com` (comma-separated for
        // more than one) in `apps/web/.env.local`, which is gitignored. Empty means Vite's own
        // default, which is every localhost form and nothing else.
        //
        // Read through `loadEnv` rather than `process.env`: a config module is evaluated BEFORE
        // Vite loads any `.env` file, so `process.env` is still the bare shell environment here
        // and a value set in `.env.local` would silently not arrive.
        allowedHosts: loadEnv(mode, resolve(import.meta.dirname), 'VITE_')
            .VITE_ALLOWED_HOSTS?.split(',')
            .map(host => host.trim())
            .filter(host => host !== ''),
        proxy: {
            // The API mounts its routers at the root, so the /api prefix is stripped here.
            // 127.0.0.1 rather than localhost: the latter resolves to IPv6 and is refused.
            '/api': {
                target: API_TARGET,
                changeOrigin: true,
                rewrite: path => path.replace(/^\/api/, ''),
            },
            // A root-level `.m3u8`, which is the tidy public URL for the HLS output: `/live.m3u8`
            // beside `/live.mp3`. The REDIRECT to `/hls/` lives in the nginx snippet, because it
            // has to exist for the production edges too — so this hands the request to nginx and
            // lets the 302 come back through, rather than keeping a second copy of the rule that
            // could disagree with it. Without this a dev SPA (and anything tunnelled to :3002,
            // which is how this station is reached from outside) answers the SPA's index.html for
            // a playlist URL, with a 200 and no hint that anything is wrong.
            '^/[^/]+\\.m3u8$': {
                target: 'http://127.0.0.1:8080',
                changeOrigin: true,
            },
            // The HLS output, which unlike the mounts is not one upstream: nginx serves the
            // segments off the volume and proxies only the playlists to the API. Vite can do
            // neither half — the segments are in a container and the split is nginx's — so this
            // points at the edge and lets it do both. A dev SPA opened on :3002 therefore needs
            // the nginx container up to play HLS, which is the same thing being true of a
            // listener.
            '/hls': {
                target: 'http://127.0.0.1:8080',
                changeOrigin: true,
                timeout: 0,
                proxyTimeout: 0,
            },
            // So the monitor works when the SPA is opened on this port directly rather
            // than through nginx, which proxies the mounts in dev and prod alike.
            [MOUNT_PATTERN]: {
                target: ICECAST_TARGET,
                changeOrigin: true,
                // A live stream never completes: the default timeouts would cut it off
                // mid-listen, which reads as the station dropping out.
                timeout: 0,
                proxyTimeout: 0,
            },
        },
    },
}));
