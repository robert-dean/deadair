import { JobNames } from '#src/modules/shared/job.names.js';
import { Constructor, Injectable } from 'injectkit';
import { Job } from '@maroonedsoftware/jobbroker';

@Injectable()
export class FakeJob implements Job {
    async run(): Promise<void> {
        console.log('FakeJob executed');
    }
}

export const JobMappings: Record<JobNames, Constructor<Job>> = {
    fake: FakeJob,
};
