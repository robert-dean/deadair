import { useState } from 'react';

export interface ImportFlowOptions<TFile> {
    /** The file's text as the API's document. Throws on a file that is not one, which is what makes it unreadable. */
    parse: (text: string) => TFile;
    /** The sentence for a file that would not parse, in the importing page's own words. */
    unreadable: (name: string) => string;
    /** A readable file has been chosen: ask what it would do. */
    onRead: (file: TFile) => void;
    /** A row was switched between skip and replace, for an import that asks the station again rather than working it out here. */
    onDecide?: (file: TFile, replacing: ReadonlySet<string>) => void;
    /** The preview and the write, both of which forget their answer when the file changes or the dialog closes. */
    mutations: readonly { reset: () => void }[];
    onClose: () => void;
}

/**
 * Taking a file in, up to the point of showing what it would do.
 *
 * What the persona and break-kind imports have in common is everything that is not about their own
 * rows: the file held once parsed, the name it came under, a failure to read it, and which of the
 * things already here the operator chose to replace. What each one DOES with a preview stays on the
 * page, because the persona page lays the choices over a single answer and the break-kind page asks
 * the planner again. Playlists, languages and plugins take a file differently enough to stay out.
 */
export function useImportFlow<TFile>({ parse, unreadable: unreadableSentence, onRead, onDecide, mutations, onClose }: ImportFlowOptions<TFile>) {
    // The parsed document, held so the Import button sends exactly what was previewed rather than
    // re-reading a file the operator may have replaced on disk in between.
    const [file, setFile] = useState<TFile | undefined>(undefined);
    const [name, setName] = useState<string | undefined>(undefined);
    // A file that is not JSON never reaches the API, so this failure has nowhere else to live.
    const [unreadable, setUnreadable] = useState<string | undefined>(undefined);
    // Keys of what is already here that the operator chose to replace. Empty is the safe answer, and
    // the one every new file starts from.
    const [replacing, setReplacing] = useState<ReadonlySet<string>>(new Set());

    const forget = () => {
        setUnreadable(undefined);
        setReplacing(new Set());
        for (const mutation of mutations) mutation.reset();
    };

    const close = () => {
        setFile(undefined);
        setName(undefined);
        forget();
        onClose();
    };

    const choose = async (picked: File | null) => {
        if (picked === null) return;

        forget();
        setName(picked.name);

        let parsed: TFile;
        try {
            parsed = parse(await picked.text());
        } catch {
            setFile(undefined);
            setUnreadable(unreadableSentence(picked.name));
            return;
        }

        setFile(parsed);
        onRead(parsed);
    };

    const decide = (key: string, replace: boolean) => {
        if (file === undefined) return;

        const next = new Set(replacing);
        if (replace) next.add(key);
        else next.delete(key);
        setReplacing(next);
        onDecide?.(file, next);
    };

    return { file, name, unreadable, replacing, choose, decide, close };
}
