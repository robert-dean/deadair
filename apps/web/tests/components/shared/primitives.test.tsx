import { describe, expect, it } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { EmptyState } from '../../../src/components/shared/empty.state';
import { ErrorAlert } from '../../../src/components/shared/error.alert';
import { Eyebrow } from '../../../src/components/shared/eyebrow';
import { PageHeader } from '../../../src/components/shared/page.header';
import { PageSkeleton } from '../../../src/components/shared/page.skeleton';
import { StatusLamp } from '../../../src/components/shared/status.lamp';
import { render, screen } from '../../utils/render';

describe('ErrorAlert', () => {
    it('says what the server said, under the title the console wrote', () => {
        const error = new SdkError(500, 'Internal Server Error', { statusCode: 500, message: 'The pool is gone' }, new Headers());
        render(<ErrorAlert title="Settings unavailable" error={error} fallback="The station settings could not be read." />);

        expect(screen.getByText('Settings unavailable')).toBeInTheDocument();
        expect(screen.getByText(/The pool is gone/)).toBeInTheDocument();
    });

    /** The failure this exists to prevent: an empty red box on a response with no body. */
    it('falls back to the sentence the console wrote when the failure carries none', () => {
        render(<ErrorAlert title="Settings unavailable" error={undefined} fallback="The station settings could not be read." />);

        expect(screen.getByText('The station settings could not be read.')).toBeInTheDocument();
    });

    it('takes a finished sentence for the callers that already have one', () => {
        render(<ErrorAlert title="Download failed">The log tail was not written.</ErrorAlert>);

        expect(screen.getByText('The log tail was not written.')).toBeInTheDocument();
    });
});

describe('EmptyState', () => {
    it('states what is missing and what would fill it', () => {
        render(<EmptyState title="No plugins are mounted">Drop one into the plugin directory and rescan.</EmptyState>);

        expect(screen.getByText('No plugins are mounted')).toBeInTheDocument();
        expect(screen.getByText('Drop one into the plugin directory and rescan.')).toBeInTheDocument();
    });
});

describe('PageHeader', () => {
    it('holds the actions on the same line as the title', () => {
        render(<PageHeader title="Plugins" eyebrow="Station" actions={<button type="button">Rescan</button>} />);

        expect(screen.getByRole('heading', { level: 1, name: 'Plugins' })).toBeInTheDocument();
        expect(screen.getByText('Station')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Rescan' })).toBeInTheDocument();
    });
});

describe('StatusLamp', () => {
    it('names the state it is drawing, for anything not reading the colour', () => {
        render(<StatusLamp tone="ok" label="Active" />);

        expect(screen.getByLabelText('Status: Active')).toBeInTheDocument();
    });

    it('draws the loud states as a chip rather than a dot', () => {
        render(<StatusLamp tone="live" label="on air" emphasis="chip" pulse />);

        expect(screen.getByText('on air').closest('[class*="mantine-Badge-root"]')).toHaveClass('da-lamp-pulse');
    });
});

describe('PageSkeleton', () => {
    it('stands in for as many rows as are coming', () => {
        const { container } = render(<PageSkeleton variant="rows" count={4} />);

        expect(container.querySelectorAll('[class*="mantine-Skeleton-root"]')).toHaveLength(4);
    });
});

describe('Eyebrow', () => {
    it('renders the legend it was given', () => {
        render(<Eyebrow>Library</Eyebrow>);

        expect(screen.getByText('Library')).toBeInTheDocument();
    });
});
