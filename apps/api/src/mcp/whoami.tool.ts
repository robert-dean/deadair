import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { getOAuthSessionClaim } from '@maroonedsoftware/authentication';
import { requireMcpAuthenticationSession, type McpToolContext, type McpToolHandler } from '@maroonedsoftware/mcp';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { stationZone } from '#modules/director/clock.words.js';

/** What `whoami` answers: who the app is acting as, through which grant, and the station's clock. */
export interface WhoAmI {
    actorId: string;
    roles: string[];
    app?: { clientId: string; name?: string };
    scopes: string[];
    station: { timezone: string; localTime: string };
}

export const WHOAMI_TOOL = 'whoami';

/**
 * Who the connected app is acting as. No contract describes the caller, so this one is written by
 * hand rather than generated.
 *
 * It resolves `AuthorizationContext` from the request's container on every call, the way the
 * generated tools resolve their services: the tool itself is a singleton built at boot, where the
 * context holds the startup actor rather than anybody who asked.
 */
@Injectable()
export class WhoAmITool implements McpToolHandler {
    readonly definition: Tool = {
        name: WHOAMI_TOOL,
        title: 'Who am I',
        description:
            "Who this app is acting as on the station: their roles, the app's grant and what it may do, and the station's time zone and local time. Call it before anything that depends on the person's role or on what time it is at the station.",
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    };

    constructor(private readonly config: AppConfig) {}

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const session = requireMcpAuthenticationSession(context);
        if (!context.container) throw new Error(`MCP tool '${context.toolName}' needs the request container.`);
        const actor = context.container.get(AuthorizationContext).requireUser();
        const grant = getOAuthSessionClaim(session);
        const timezone = stationZone(this.config);

        const result: WhoAmI = {
            actorId: actor.actorId,
            roles: [...actor.platformRoles].sort(),
            app: grant ? { clientId: grant.clientId, name: grant.clientName } : undefined,
            scopes: grant?.scope ?? [],
            station: { timezone, localTime: DateTime.now().setZone(timezone).toISO() ?? '' },
        };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { ...result } };
    }
}
