/**
 * A BCP 47 tag as the English name of its language, for a prompt: `de` is "German", `fr-CA` is
 * "Canadian French".
 *
 * In English because the prompts it goes into are written in English. The model is told which
 * language to WRITE in, and it reads that instruction in the same language as every other one it is
 * given. A tag the runtime cannot name comes back as it was, which a model still understands better
 * than nothing.
 */
export function languageName(tag: string): string {
    try {
        return new Intl.DisplayNames('en', { type: 'language' }).of(tag) ?? tag;
    } catch {
        // A tag that is not well-formed BCP 47 throws rather than answering undefined.
        return tag;
    }
}

/**
 * The instruction that puts what a model writes for the air in the station's language.
 *
 * It names the source material because that is the part most likely to pull the other way: a
 * record's facts, a headline and a persona's sheet are very often in English whatever the station
 * broadcasts in, and a model handed English source text drifts back into English unless it is told
 * that the source and the air may differ. Titles and names are the exception, because translating
 * "Wish You Were Here" names a record that does not exist.
 *
 * One sentence shared by breaks and productions, on the rule that two prompts stating the same
 * station policy in different words is how the two drift.
 */
export function languageRule(language: string): string {
    const name = languageName(language);
    return (
        `Write every word you say in ${name}, the way a native ${name} radio presenter would say it. ` +
        `Some of what you are given is in English; tell it in ${name}. Keep the titles of records, albums and shows, and people's names, as they are written.`
    );
}
