import net from 'node:net';
export function forward(localPort, targetHost, targetPort) {
    const p = new URL(process.env.ALL_PROXY);
    return new Promise(resolve => {
        const server = net.createServer(client => {
            const s = net.connect(Number(p.port), p.hostname, () => s.write(Buffer.from([5, 1, 2])));
            let stage = 0;
            const onData = buf => {
                if (stage === 0) {
                    const u = Buffer.from(decodeURIComponent(p.username)), w = Buffer.from(decodeURIComponent(p.password));
                    s.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([w.length]), w]));
                    stage = 1; return;
                }
                if (stage === 1) {
                    if (buf[1] !== 0) { client.destroy(); s.destroy(); return; }
                    const h = Buffer.from(targetHost);
                    const req = Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([targetPort >> 8, targetPort & 255])]);
                    s.write(req); stage = 2; return;
                }
                if (stage === 2) {
                    if (buf[1] !== 0) { console.error('socks connect failed', buf[1]); client.destroy(); s.destroy(); return; }
                    s.removeListener('data', onData);
                    s.pipe(client); client.pipe(s);
                    stage = 3; return;
                }
            };
            s.on('data', onData);
            s.on('error', e => { console.error('proxy err', e.message); client.destroy(); });
            client.on('error', () => s.destroy());
        });
        server.listen(localPort, '127.0.0.1', () => resolve(server));
    });
}
