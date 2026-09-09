import { DataRepository } from '#src/modules/data/data.repository.js';
import { PhoneFactor, PhoneFactorRepository } from '@maroonedsoftware/authentication';
import { Injectable } from 'injectkit';

@Injectable()
export class DeadairPhoneFactorRepository extends DataRepository implements PhoneFactorRepository {
    listFactors(_actorId: string, _active?: boolean): Promise<PhoneFactor[]> {
        throw new Error('Method not implemented.');
    }
    findFactor?(_value: string): Promise<PhoneFactor | undefined> {
        throw new Error('Method not implemented.');
    }
    async createFactor(_actorId: string, _value: string): Promise<PhoneFactor> {
        throw new Error('createFactor is not implemented');
    }

    async lookupFactor(_actorId: string, _value: string): Promise<PhoneFactor | undefined> {
        throw new Error('lookupFactor is not implemented');
    }

    async getFactor(_actorId: string, _factorId: string): Promise<PhoneFactor> {
        throw new Error('getFactor is not implemented');
    }

    async deleteFactor(_actorId: string, _factorId: string): Promise<void> {
        throw new Error('deleteFactor is not implemented');
    }
}
