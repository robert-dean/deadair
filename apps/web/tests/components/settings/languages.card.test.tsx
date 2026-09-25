import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguagesCard } from '../../../src/components/settings/languages.card';
import { saveDownload } from '../../../src/components/shared/download';
import packageJson from '../../../package.json';
import { render, screen, setupUser } from '../../utils/render';

vi.mock('../../../src/components/shared/download', () => ({ saveDownload: vi.fn() }));

describe('LanguagesCard', () => {
    beforeEach(() => {
        vi.mocked(saveDownload).mockReset();
    });

    it('says which console version its English is from', () => {
        render(<LanguagesCard />);
        expect(screen.getByText(`Built in, as of console ${packageJson.version}`)).toBeInTheDocument();
    });

    it('exports the English as a language pack', async () => {
        render(<LanguagesCard />);
        await setupUser().click(screen.getByRole('button', { name: 'Export as a language pack' }));

        expect(saveDownload).toHaveBeenCalledTimes(1);
        const [text, filename, type] = vi.mocked(saveDownload).mock.calls[0]!;
        expect(filename).toBe('deadair-console-en.json');
        expect(type).toBe('application/json');
        const pack = JSON.parse(text as string);
        expect(pack).toMatchObject({ format: 'deadair.console-language', locale: 'en', madeFor: packageJson.version });
        expect(pack.catalog.common.action.cancel).toBe('Cancel');
    });
});
