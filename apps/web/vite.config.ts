import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

// The dev API port: PORT in apps/api/.env. nginx.dev.conf proxies :8080 to the same host port.
const API_TARGET = 'http://127.0.0.1:3333';

// Icecast, on the port docker-compose publishes to the host.
const ICECAST_TARGET = 'http://127.0.0.1:8000';

/**
 * The Icecast mount path, for the console's stream monitor.
 *
 * The station's real mount is the `stream.mount` setting (the API reports it as
 * `PlayoutStatus.mountPath`), but a dev proxy cannot read the database, so this
 * matches the default — the same coupling `nginx/snippets/icecast.conf` carries.
 * Change the setting away from the default and this has to change with it.
 */
const MOUNT_PATH = '/live.mp3';

export default defineConfig({
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
        allowedHosts: ['radio.robertdean.dev'],
        proxy: {
            // The API mounts its routers at the root, so the /api prefix is stripped here.
            // 127.0.0.1 rather than localhost: the latter resolves to IPv6 and is refused.
            '/api': {
                target: API_TARGET,
                changeOrigin: true,
                rewrite: path => path.replace(/^\/api/, ''),
            },
            // So the monitor works when the SPA is opened on this port directly rather
            // than through nginx, which proxies the mount in dev and prod alike.
            [MOUNT_PATH]: {
                target: ICECAST_TARGET,
                changeOrigin: true,
                // A live stream never completes: the default timeouts would cut it off
                // mid-listen, which reads as the station dropping out.
                timeout: 0,
                proxyTimeout: 0,
            },
        },
    },
});
