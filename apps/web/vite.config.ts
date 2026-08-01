import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

// The dev API port: PORT in apps/api/.env. nginx.dev.conf proxies :8080 to the same host port.
const API_TARGET = 'http://127.0.0.1:3333';

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
        proxy: {
            // The API mounts its routers at the root, so the /api prefix is stripped here.
            // 127.0.0.1 rather than localhost: the latter resolves to IPv6 and is refused.
            '/api': {
                target: API_TARGET,
                changeOrigin: true,
                rewrite: path => path.replace(/^\/api/, ''),
            },
        },
    },
});
