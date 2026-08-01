import { EmailFactorRepository, OidcActorEmailLookup } from '@maroonedsoftware/authentication';
import { Injectable } from 'injectkit';

@Injectable()
export class DeadairOidcActorEmailLookup implements OidcActorEmailLookup {
    constructor(private readonly emailFactorRepository: EmailFactorRepository) {}

    async findActorByEmail(email: string): Promise<string | undefined> {
        const factor = await this.emailFactorRepository.findFactor(email);
        if (!factor || !factor.active) return undefined;
        return factor.actorId;
    }
}
