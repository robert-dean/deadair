import { Injectable } from 'injectkit';
import { DataRepository } from '../data/data.repository.js';

@Injectable()
export class OnboardingRepository extends DataRepository {}
