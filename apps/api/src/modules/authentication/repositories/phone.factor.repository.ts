import { DataRepository } from '#src/modules/data/data.repository.js';
import { PhoneFactor, PhoneFactorRepository } from '@maroonedsoftware/authentication';
import { Injectable } from 'injectkit';

@Injectable()
export class DeadairPhoneFactorRepository extends DataRepository implements PhoneFactorRepository {
    listFactors(actorId: string, active?: boolean): Promise<PhoneFactor[]> {
        throw new Error('Method not implemented.');
    }
    findFactor?(value: string): Promise<PhoneFactor | undefined> {
        throw new Error('Method not implemented.');
    }
    async createFactor(actorId: string, value: string): Promise<PhoneFactor> {
        throw new Error('createFactor is not implemented');
    }

    async lookupFactor(actorId: string, value: string): Promise<PhoneFactor | undefined> {
        throw new Error('lookupFactor is not implemented');
    }

    async getFactor(actorId: string, factorId: string): Promise<PhoneFactor> {
        throw new Error('getFactor is not implemented');
    }

    async deleteFactor(actorId: string, factorId: string): Promise<void> {
        throw new Error('deleteFactor is not implemented');
    }
}
