import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    GeneratedPersona,
    PersonaInput,
    PersonaList,
    PersonaNoteList,
    PersonaNoteState,
    PersonaNoteWrite,
    PersonaRehearsal,
    PersonaStoryDetailWrite,
    PersonaStoryList,
    PersonaStoryState,
    PersonaStoryWrite,
} from '@deadair/sdk';

import { downloadFilename, saveJsonDownload } from '../components/shared/download';
import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long the persona list stays fresh.
 *
 * The same reasoning as `SETTINGS_STALE_TIME`: these move when an operator moves them, and every
 * write here answers with the whole list, which is written straight into the cache below. The only
 * invisible writer is somebody editing the table by hand.
 */
const PERSONAS_STALE_TIME = 30_000;

export const personasOptions = queryOptions({
    queryKey: queryKeys.personas.list(),
    queryFn: () => sdk.personas.listPersonas(),
    staleTime: PERSONAS_STALE_TIME,
});

/** Every persona this station has, and which one is on air. */
export function usePersonas() {
    return useQuery(personasOptions);
}

/**
 * Every write, sharing one success path.
 *
 * The API answers each of them with the whole list rather than the row it touched, because each of
 * them can change more than that row: putting one on air takes another off, and deleting the active
 * one leaves the station with none. So the answer is written into the cache and nothing refetches.
 */
function useListWrite<TArgs>(mutationFn: (args: TArgs) => Promise<PersonaList>) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onSuccess: (personas: PersonaList) => {
            queryClient.setQueryData(queryKeys.personas.list(), personas);
        },
    });
}

export const useCreatePersona = () => useListWrite((body: PersonaInput) => sdk.personas.createPersona(body));

export const useUpdatePersona = () => useListWrite(({ id, body }: { id: string; body: PersonaInput }) => sdk.personas.updatePersona(id, body));

export const useDeletePersona = () => useListWrite((id: string) => sdk.personas.deletePersona(id));

export const usePutPersonaOnAir = () => useListWrite((id: string) => sdk.personas.putPersonaOnAir(id));

/**
 * Put back whichever of the station's own personas are missing.
 *
 * Touches nothing already here and puts nothing on air, so it is safe to press twice — which is
 * what makes it a plain button rather than something behind a confirmation.
 */
export const useRestorePersonas = () => useListWrite(() => sdk.personas.restoreStationPersonas());

/**
 * Ask a persona for a break it will never air.
 *
 * A mutation rather than a query despite reading nothing, because it spends a generation: it must
 * not be prefetched, retried on a window focus, or served from a cache. Every click is meant to be
 * a fresh reading, since the point of pressing it twice is to hear what an edit changed.
 *
 * Nothing is written into the persona cache — a rehearsal changes no row.
 */
export const useRehearsePersona = () =>
    useMutation<PersonaRehearsal, Error, string>({
        mutationFn: (id: string) => sdk.personas.rehearsePersona(id),
    });

/**
 * One character's notebook: what it has settled into, and what it has said before.
 *
 * Fetched only when a panel is open, because most of the time nobody is looking at one and it is a
 * per-character read rather than part of the list. Same staleness as the list above, and for the same
 * reason: nothing moves these except an operator and the nightly pass.
 */
export function usePersonaNotes(id: string | undefined) {
    return useQuery({
        queryKey: queryKeys.personas.notes(id ?? ''),
        queryFn: () => sdk.personas.listPersonaNotes(id!),
        staleTime: PERSONAS_STALE_TIME,
        enabled: id !== undefined,
    });
}

/**
 * Every notebook write, sharing one success path.
 *
 * The API answers each with the whole notebook for the same reason the persona routes answer with the
 * whole list: accepting a proposal moves a row between two sections of one panel, so a caller handed
 * back the row it named is holding a list it has to refetch to draw.
 */
function useNoteWrite<TArgs extends { id: string }>(mutationFn: (args: TArgs) => Promise<PersonaNoteList>) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onSuccess: (notes: PersonaNoteList) => {
            queryClient.setQueryData(queryKeys.personas.notes(notes.personaId), notes);
        },
    });
}

export const useWritePersonaNote = () =>
    useNoteWrite(({ id, body }: { id: string; body: PersonaNoteWrite }) => sdk.personas.writePersonaNote(id, body));

export const useUpdatePersonaNote = () =>
    useNoteWrite(({ id, noteId, body }: { id: string; noteId: string; body: PersonaNoteWrite }) => sdk.personas.updatePersonaNote(id, noteId, body));

export const useDeletePersonaNote = () =>
    useNoteWrite(({ id, noteId }: { id: string; noteId: string }) => sdk.personas.deletePersonaNote(id, noteId));

/**
 * Accept a proposal, turn one down, or rest an active note.
 *
 * Turning one down is deliberately NOT a delete: `rejected` outlives the pass that proposed it, and a
 * deleted proposal comes back on the next run, forever.
 */
export const useSetPersonaNoteState = () =>
    useNoteWrite(({ id, noteId, state }: { id: string; noteId: string; state: PersonaNoteState['state'] }) =>
        sdk.personas.setPersonaNoteState(id, noteId, { state }),
    );

/** What one character has lived through. Read on the same terms as the notebook beside it. */
export function usePersonaStories(id: string | undefined) {
    return useQuery({
        queryKey: queryKeys.personas.stories(id ?? ''),
        queryFn: () => sdk.personas.listPersonaStories(id!),
        staleTime: PERSONAS_STALE_TIME,
        enabled: id !== undefined,
    });
}

/**
 * Every story write, sharing one success path.
 *
 * `useNoteWrite`'s arrangement one table over, and the same reason: every route here answers with the
 * whole shelf, because accepting a proposal — or adding a detail to a story three rows down — changes
 * a list rather than a row.
 */
function useStoryWrite<TArgs extends { id: string }>(mutationFn: (args: TArgs) => Promise<PersonaStoryList>) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onSuccess: (stories: PersonaStoryList) => {
            queryClient.setQueryData(queryKeys.personas.stories(stories.personaId), stories);
        },
    });
}

export const useWritePersonaStory = () =>
    useStoryWrite(({ id, body }: { id: string; body: PersonaStoryWrite }) => sdk.personas.writePersonaStory(id, body));

export const useUpdatePersonaStory = () =>
    useStoryWrite(({ id, storyId, body }: { id: string; storyId: string; body: PersonaStoryWrite }) =>
        sdk.personas.updatePersonaStory(id, storyId, body),
    );

export const useDeletePersonaStory = () =>
    useStoryWrite(({ id, storyId }: { id: string; storyId: string }) => sdk.personas.deletePersonaStory(id, storyId));

/** Accept a proposal or turn one down. A rejection outlives the pass, for the notebook's reason. */
export const useSetPersonaStoryState = () =>
    useStoryWrite(({ id, storyId, state }: { id: string; storyId: string; state: PersonaStoryState['state'] }) =>
        sdk.personas.setPersonaStoryState(id, storyId, { state }),
    );

export const useAddPersonaStoryDetail = () =>
    useStoryWrite(({ id, storyId, body }: { id: string; storyId: string; body: PersonaStoryDetailWrite }) =>
        sdk.personas.addPersonaStoryDetail(id, storyId, body),
    );

export const useDeletePersonaStoryDetail = () =>
    useStoryWrite(({ id, storyId, detailId }: { id: string; storyId: string; detailId: string }) =>
        sdk.personas.deletePersonaStoryDetail(id, storyId, detailId),
    );

export const useSetPersonaStoryDetailState = () =>
    useStoryWrite(({ id, storyId, detailId, state }: { id: string; storyId: string; detailId: string; state: PersonaStoryState['state'] }) =>
        sdk.personas.setPersonaStoryDetailState(id, storyId, detailId, { state }),
    );

/**
 * Turn a description into a persona.
 *
 * A mutation for the reason a rehearsal is one — it spends a generation — and it writes nothing into
 * the persona cache, because nothing has been saved. What comes back is a form's contents, which the
 * editor drops into its fields for the operator to edit and save themselves.
 */
export const useGeneratePersona = () =>
    useMutation<GeneratedPersona, Error, string>({
        mutationFn: (description: string) => sdk.personas.generatePersona({ description }),
    });

/**
 * Save a character to the operator's disk: one of them, or the whole roster.
 *
 * A plain function rather than a query or a mutation, on `fetchVoiceSample`'s rule — nothing is
 * cached, nothing is invalidated, and the result is a file rather than state this app holds. The
 * caller owns reporting the failure, because where it belongs differs: one card for one character,
 * the page header for the roster.
 *
 * The filename comes off the response's own `Content-Disposition` rather than being composed here.
 * The server dates it, and a second opinion about what the file is called is a second thing to keep
 * in step.
 */
export async function exportPersonas(id?: string): Promise<void> {
    const { data, headers } = id === undefined ? await sdk.personas.exportPersonas() : await sdk.personas.exportPersona(id);

    saveJsonDownload(data, downloadFilename(headers.contentDisposition, id === undefined ? 'personas.json' : `${id}.json`));
}
