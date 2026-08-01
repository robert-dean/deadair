import { AuthenticationSession, AuthenticationSessionService, JwtAuthenticationIssuer } from '@maroonedsoftware/authentication';
import { Injectable } from 'injectkit';
import { unauthorizedError } from '@maroonedsoftware/errors';

@Injectable()
export class DeadairJwtAuthenticationIssuer extends JwtAuthenticationIssuer {
    constructor(private readonly sessionService: AuthenticationSessionService) {
        super();
    }

    override async parse(token: string, _payload: unknown): Promise<AuthenticationSession> {
        const { session } = await this.sessionService.lookupSessionFromJwt(token);
        if (!session) {
            throw unauthorizedError('Bearer error="invalid_token"');
        }
        return session;
    }
}
