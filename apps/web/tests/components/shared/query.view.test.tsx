import { describe, expect, it } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { QueryView } from '../../../src/components/shared/query.view';
import { render, screen } from '../../utils/render';

const failure = new SdkError(503, 'Unavailable', { statusCode: 503, message: 'The station is restarting' }, new Headers());

function view(query: { data: string[] | undefined; error: unknown; isPending: boolean }) {
    return render(
        <QueryView
            query={query}
            skeleton={<p>loading</p>}
            errorTitle="The voices could not be read"
            errorFallback="Try again in a moment."
            isEmpty={list => list.length === 0}
            empty={<p>no voices</p>}
        >
            {list => (
                <ul>
                    {list.map(name => (
                        <li key={name}>{name}</li>
                    ))}
                </ul>
            )}
        </QueryView>,
    );
}

describe('QueryView', () => {
    it('draws the skeleton while the first answer is coming, and nothing else', () => {
        view({ data: undefined, error: undefined, isPending: true });

        expect(screen.getByText('loading')).toBeInTheDocument();
        expect(screen.queryByText('no voices')).not.toBeInTheDocument();
    });

    it('draws the answer', () => {
        view({ data: ['Kokoro', 'Chatterbox'], error: undefined, isPending: false });

        expect(screen.getByText('Kokoro')).toBeInTheDocument();
        expect(screen.queryByText('loading')).not.toBeInTheDocument();
    });

    it('says an empty answer is empty rather than drawing nothing', () => {
        view({ data: [], error: undefined, isPending: false });

        expect(screen.getByText('no voices')).toBeInTheDocument();
    });

    it('reports a failure with the server sentence', () => {
        view({ data: undefined, error: failure, isPending: false });

        expect(screen.getByText('The voices could not be read')).toBeInTheDocument();
        expect(screen.getByText(/The station is restarting/)).toBeInTheDocument();
    });

    // The rule worth keeping: a failed refetch does not blank the list the operator was reading.
    it('keeps drawing the last answer under a failed refetch', () => {
        view({ data: ['Kokoro'], error: failure, isPending: false });

        expect(screen.getByText('The voices could not be read')).toBeInTheDocument();
        expect(screen.getByText('Kokoro')).toBeInTheDocument();
    });
});
