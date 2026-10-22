import { describe, expect, it } from 'vitest';

import { CopyableCode } from '../../../src/components/shared/copyable.code';
import { render, screen } from '../../utils/render';

describe('CopyableCode', () => {
    it('shows the whole value beside a button that copies it', () => {
        render(<CopyableCode value="da_live_0123456789abcdef" />);

        expect(screen.getByText('da_live_0123456789abcdef')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
    });
});
