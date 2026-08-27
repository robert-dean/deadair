// Eight nav links became one destination, so what is worth testing is that nothing was lost in the
// folding: every tab is offered, the selected one is the only body constructed, and the tab is a
// PLACE — driven by the caller's URL rather than by state this component keeps to itself.

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { isVoiceTab, VoicePage, VOICE_TABS } from '../../../src/components/voice/voice.page';
import { render, screen, setupUser } from '../../utils/render';

// Every hosted page opens its own queries on mount. They are covered by their own suites; here they
// only have to not throw, so the whole SDK surface the eight of them touch answers empty.
vi.mock('../../../src/api/client', () => {
    const empty = () => Promise.resolve({});
    return {
        sdk: {
            personas: { listPersonas: () => Promise.resolve({ personas: [] }), listPersonaVoices: empty },
            voices: { listVoices: () => Promise.resolve({ voices: [] }) },
            segments: { listSegments: () => Promise.resolve({ segments: [] }) },
            pronunciations: { listPronunciations: () => Promise.resolve({ pronunciations: [] }) },
            pads: { listPads: () => Promise.resolve({ pads: [] }), listPadSets: () => Promise.resolve({ sets: [] }) },
            topics: { listTopics: () => Promise.resolve({ topics: [] }) },
            productions: { listProductions: () => Promise.resolve({ productions: [] }) },
            scripts: { listScripts: () => Promise.resolve({ scripts: [], total: 0 }) },
            render: { listVoices: () => Promise.resolve({ voices: [] }) },
        },
    };
});

vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
        <a href={to} {...rest}>
            {children}
        </a>
    ),
}));

describe('VoicePage', () => {
    it('offers every question about what the station says', () => {
        render(<VoicePage tab="characters" onSelect={() => undefined} />);

        for (const tab of VOICE_TABS) {
            expect(screen.getByRole('tab', { name: new RegExp(tab.label) })).toBeInTheDocument();
        }
    });

    it('marks exactly one tab as the one you are on', () => {
        render(<VoicePage tab="segments" onSelect={() => undefined} />);

        const selected = screen.getAllByRole('tab').filter(tab => tab.getAttribute('aria-selected') === 'true');
        expect(selected).toHaveLength(1);
        expect(selected[0]).toHaveTextContent('Segments');
    });

    it('reports the chosen tab rather than selecting it itself', async () => {
        // The tab is a place: it lives in the URL so a link into one is a link. This component must
        // therefore ask to move rather than move, or the URL and the screen drift apart.
        const onSelect = vi.fn();
        const user = setupUser();
        render(<VoicePage tab="characters" onSelect={onSelect} />);

        await user.click(screen.getByRole('tab', { name: /Pronunciations/ }));

        expect(onSelect).toHaveBeenCalledWith('pronunciations');
        // Still showing what it was told to show. Nothing moved on its own.
        expect(screen.getByRole('tab', { name: /Characters/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('draws only the tab it is on', () => {
        // Each body opens queries on mount, so building all eight to show one would put the whole
        // destination's network cost on every visit.
        render(<VoicePage tab="pronunciations" onSelect={() => undefined} />);

        expect(screen.getByRole('heading', { name: 'Pronunciations', level: 2 })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Soundboard', level: 2 })).not.toBeInTheDocument();
    });

    it('draws one page title, not two', () => {
        // Every hosted page opens with its own `PageHeader`. Under a destination that has already
        // named itself, a second h1 is both a duplicated line and a broken document outline.
        render(<VoicePage tab="voices" onSelect={() => undefined} />);

        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Voice');
    });
});

describe('isVoiceTab', () => {
    it('accepts the tabs that exist', () => {
        expect(isVoiceTab('soundboard')).toBe(true);
    });

    it('rejects anything else, so a truncated link lands on the destination', () => {
        expect(isVoiceTab('segment')).toBe(false);
        expect(isVoiceTab(undefined)).toBe(false);
    });
});
