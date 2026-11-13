// The upload card's one job beyond sending a file: saying what the kind it is filed under will DO,
// before it commits. A bed is the kind that most needs saying, because it never airs on its own.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SegmentUploadCard } from '../../../src/components/segments/segment.upload.card';
import { render, screen, setupUser } from '../../utils/render';

vi.mock('../../../src/api/client', () => ({ sdk: { render: {} } }));

afterEach(() => {
    vi.resetAllMocks();
});

describe('SegmentUploadCard', () => {
    it('explains a bed rather than warning that it will appear on the format clock', async () => {
        const user = setupUser();
        render(<SegmentUploadCard kinds={[]} onDone={() => {}} />);

        const kind = screen.getAllByLabelText('Kind')[0]!;
        await user.clear(kind);
        await user.type(kind, 'bed');

        expect(await screen.findByText(/A music bed runs quietly under a break/)).toBeInTheDocument();
        expect(screen.queryByText(/will appear in the format clock/)).not.toBeInTheDocument();
    });

    it('still warns about a kind the station has never held', async () => {
        const user = setupUser();
        render(<SegmentUploadCard kinds={[]} onDone={() => {}} />);

        const kind = screen.getAllByLabelText('Kind')[0]!;
        await user.clear(kind);
        await user.type(kind, 'sponsor');

        expect(await screen.findByText(/will appear in the format clock/)).toBeInTheDocument();
    });
});
