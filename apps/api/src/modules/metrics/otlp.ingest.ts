import { Injectable } from 'injectkit';
import { OtlpMetricsReceiver, type OtlpReceiveResult } from '@maroonedsoftware/telemetry';

/** The most distinct metric names kept from every sender together, for the life of the process. */
export const MAX_RECEIVED_NAMES = 500;

/**
 * The one OTLP receiver this process keeps.
 *
 * A singleton because the receiver remembers each cumulative series' last value, which is how a
 * running total becomes an increase, and remembers which series it has admitted, which is how the cap
 * holds across requests. A receiver per request would turn every cumulative sum into nothing and let
 * every request admit a fresh set of series.
 *
 * A change to the series cap starts a new receiver, which costs every cumulative series one point:
 * the same as the sender restarting, and rarer.
 */
@Injectable()
export class OtlpIngest {
    private receiver: { maxSeriesPerName: number; receiver: OtlpMetricsReceiver } | undefined;

    receive(body: unknown, maxSeriesPerName: number): OtlpReceiveResult {
        if (this.receiver?.maxSeriesPerName !== maxSeriesPerName) {
            this.receiver = { maxSeriesPerName, receiver: new OtlpMetricsReceiver({ maxSeriesPerName, maxNames: MAX_RECEIVED_NAMES }) };
        }
        return this.receiver.receiver.receive(body);
    }
}
