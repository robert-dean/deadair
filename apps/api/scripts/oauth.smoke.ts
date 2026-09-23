/**
 * The whole OAuth flow an MCP client runs, against a real station, over HTTP.
 *
 * The unit and router tests cover each piece with the others stood in for. What they cannot cover
 * is that the pieces meet: that the edge forwards discovery, that the addresses the metadata names
 * are the ones that answer, that a code the console approves is one the token endpoint redeems, and
 * that the token it mints is accepted at the MCP endpoint and refused everywhere else. This walks it
 * in the order Claude does, and says which step broke.
 *
 * It WRITES: it registers a client (which lapses on its own after ninety days of disuse) and
 * approves it, and it disconnects that approval again at the end, whichever way the run goes.
 *
 * It needs an access token for a console session, because approving an app is something a signed-in
 * person does and an API key is refused there on purpose. Copy one from the console's requests in
 * the browser's developer tools; it lasts as long as that session's access token does.
 *
 * Run from `apps/api`:
 *   DEADAIR_ORIGIN=https://radio.example.com DEADAIR_TOKEN=<console access token> \
 *     node --import @swc-node/register/esm-register ./scripts/oauth.smoke.ts
 *
 * OAuth has to be switched on under Settings, Sign-in and security.
 */
import { createHash, randomBytes } from 'node:crypto';
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';

// Read the way the other scripts read their settings: the environment, or an `.env` beside it.
const config = await new AppConfigBuilder()
    .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
    .addResolver(new AppConfigResolverEnv())
    .buildSnapshot();

const origin = String(config.get('DEADAIR_ORIGIN', '')).replace(/\/+$/, '');
const operatorToken = String(config.get('DEADAIR_TOKEN', ''));
if (origin === '' || operatorToken === '') {
    console.error('Set DEADAIR_ORIGIN to the station origin and DEADAIR_TOKEN to a console access token.');
    process.exit(2);
}

const api = `${origin}/api`;
const resource = `${api}/mcp`;
const REDIRECT = 'http://127.0.0.1/callback';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): boolean {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
    return ok;
}

async function json(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text();
    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        return { raw: text.slice(0, 200) };
    }
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const form = (fields: Record<string, string>) => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
});
const mcp = (token: string | undefined, body: unknown) =>
    fetch(resource, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? bearer(token) : {}) },
        body: JSON.stringify(body),
    });

let grantId: string | undefined;

try {
    // 1. Discovery, as a client with nothing but the MCP address finds it.
    const challenge = await mcp(undefined, { jsonrpc: '2.0', id: 0, method: 'ping' });
    const wwwAuthenticate = challenge.headers.get('www-authenticate') ?? '';
    check('the MCP endpoint answers an anonymous caller 401', challenge.status === 401, String(challenge.status));
    check('and its challenge names the resource metadata', wwwAuthenticate.includes('resource_metadata='), wwwAuthenticate);

    const resourceMetadata = await json(await fetch(`${origin}/.well-known/oauth-protected-resource/api/mcp`));
    check('the resource metadata names this endpoint', resourceMetadata['resource'] === resource, String(resourceMetadata['resource']));

    const metadata = await json(await fetch(`${origin}/.well-known/oauth-authorization-server`));
    check('the issuer is the origin', metadata['issuer'] === origin, String(metadata['issuer']));
    check('PKCE S256 is advertised', JSON.stringify(metadata['code_challenge_methods_supported']) === '["S256"]');
    const registrationEndpoint = String(metadata['registration_endpoint'] ?? '');
    const tokenEndpoint = String(metadata['token_endpoint'] ?? '');
    if (!check('dynamic registration is on', registrationEndpoint !== '')) throw new Error('nothing to register with');

    // 2. Registration, as Claude does on every connection.
    const registration = await fetch(registrationEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: 'deadair OAuth smoke', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }),
    });
    const client = await json(registration);
    const clientId = String(client['client_id'] ?? '');
    if (!check('registration answers 201 with a client id', registration.status === 201 && clientId !== '', String(registration.status))) {
        throw new Error('no client');
    }

    // 3. The consent page's half, done here through the API with the operator's session.
    const verifier = randomBytes(32).toString('base64url');
    const challengeParam = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(12).toString('base64url');
    const query = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challengeParam,
        code_challenge_method: 'S256',
        state,
        scope: 'mcp',
        resource,
    }).toString();

    const context = await json(
        await fetch(`${api}/auth/oauth/authorize/context`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...bearer(operatorToken) },
            body: JSON.stringify({ query: `?${query}` }),
        }),
    );
    if (!check('the station reads the request for consent', context['kind'] === 'context', JSON.stringify(context).slice(0, 200))) {
        throw new Error('no consent context');
    }

    const approved = await json(
        await fetch(`${api}/auth/oauth/authorize/approve`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...bearer(operatorToken) },
            body: JSON.stringify({ requestId: context['requestId'] }),
        }),
    );
    const redirectUrl = new URL(String(approved['redirectUrl'] ?? 'http://invalid'));
    const code = redirectUrl.searchParams.get('code') ?? '';
    check('approving answers the app a code', code !== '', redirectUrl.toString().slice(0, 120));
    check('with the state it sent', redirectUrl.searchParams.get('state') === state);
    check('and the issuer (RFC 9207)', redirectUrl.searchParams.get('iss') === origin);

    // 4. The token endpoint, form-encoded, as Claude sends it.
    const issued = await json(
        await fetch(
            tokenEndpoint,
            form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier, client_id: clientId, resource }),
        ),
    );
    const accessToken = String(issued['access_token'] ?? '');
    const refreshToken = String(issued['refresh_token'] ?? '');
    if (!check('the code is exchanged for tokens', accessToken !== '' && refreshToken !== '', JSON.stringify(issued).slice(0, 200))) {
        throw new Error('no tokens');
    }
    const replayed = await json(
        await fetch(
            tokenEndpoint,
            form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier, client_id: clientId }),
        ),
    );
    check('the same code a second time is invalid_grant', replayed['error'] === 'invalid_grant', String(replayed['error']));

    // 5. The token, where it works and where it must not.
    const initialized = await mcp(accessToken, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } },
    });
    const initBody = await json(initialized);
    check('the token initializes the MCP endpoint', initialized.status === 200 && initBody['result'] !== undefined, String(initialized.status));

    const tools = await json(await mcp(accessToken, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    check('tools/list answers', tools['result'] !== undefined, JSON.stringify(tools).slice(0, 120));

    const elsewhere = await fetch(`${api}/settings`, { headers: bearer(accessToken) });
    check("the app's token is refused by the rest of the API", elsewhere.status === 401, String(elsewhere.status));

    const consoleAtMcp = await mcp(operatorToken, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
    check(
        'a console session is refused at the MCP endpoint',
        consoleAtMcp.status === 401 || consoleAtMcp.status === 403,
        String(consoleAtMcp.status),
    );

    // 6. Refresh, rotation, and replay.
    const refreshed = await json(await fetch(tokenEndpoint, form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId })));
    check(
        'the refresh token is exchanged for a new pair',
        typeof refreshed['access_token'] === 'string' && refreshed['refresh_token'] !== refreshToken,
    );
    const replay = await json(await fetch(tokenEndpoint, form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId })));
    check('the spent refresh token is invalid_grant', replay['error'] === 'invalid_grant', String(replay['error']));

    // Find the grant, to disconnect it below.
    const grants = await json(await fetch(`${api}/auth/oauth/grants`, { headers: bearer(operatorToken) }));
    grantId = ((grants['grants'] as { id: string; clientId: string }[] | undefined) ?? []).find(grant => grant.clientId === clientId)?.id;
    check('the approval is listed among your connected apps', grantId !== undefined);
} catch (error) {
    check('the run finished', false, error instanceof Error ? error.message : String(error));
} finally {
    if (grantId !== undefined) {
        const revoked = await fetch(`${api}/auth/oauth/grants/${grantId}`, { method: 'DELETE', headers: bearer(operatorToken) });
        check('the approval is disconnected again', revoked.status === 204, String(revoked.status));
    }
}

console.log(failures === 0 ? '\nall good' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
