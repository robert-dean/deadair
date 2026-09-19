import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { useEffect, useState } from 'react';

import { DEFAULT_ORIGIN, loadCommunity, type CommunityData } from './catalog';

/*
 * The one piece of the catalogue that needs Docusaurus, apart from the rest so that catalog.ts stays
 * plain TypeScript the tests can import.
 */

let loading: Promise<CommunityData> | undefined;

/** The origin this build reads the catalogue from. */
function useOrigin(): string {
    const { siteConfig } = useDocusaurusContext();
    const configured = siteConfig.customFields?.communityOrigin;
    return typeof configured === 'string' && configured !== '' ? configured.replace(/\/+$/, '') : DEFAULT_ORIGIN;
}

/**
 * The catalogue for a page, fetched once per visit however many pages ask. `undefined` until it
 * arrives, which is also what the static build renders, since effects do not run there.
 */
export function useCommunity(): CommunityData | undefined {
    const origin = useOrigin();
    const [data, setData] = useState<CommunityData>();
    useEffect(() => {
        let current = true;
        loading ??= loadCommunity(origin);
        void loading.then(result => {
            if (current) setData(result);
        });
        return () => {
            current = false;
        };
    }, [origin]);
    return data;
}
