// Not a test: the input the late-host guard in plugin.host.held.test.ts must flag. Line 9 is the read.
import { Plugin } from '../src/plugin.base.js';

export class ProbePlugin extends Plugin {
    async speak(): Promise<void> {
        const host = this.host;
        await host.config.get();
        // Read again after awaiting: the guard's whole job is to find this line.
        this.host.logger.info('late');
    }
}
