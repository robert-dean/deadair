options {
    keys: {
        area: languages
    }
}

# A language pack: every word the console says, in one language, as the file a translator made. The same document is exported, imported and stored. The console's language only; what the station broadcasts in is the `stream.language` setting
contract ConsoleLanguagePack: {
    format: literal("deadair.console-language") # Says the file is a console language pack
    version: int(min=1) # The version of the document's shape. This station reads version 1
    locale: string(min=2, max=35) # The language, as a BCP 47 tag such as `de` or `pt-BR`. Never English, which is built into the console
    name: string(min=1, max=100) # The language's name in itself, as the console's picker shows it: `Deutsch`, not `German`
    direction: enum(ltr, rtl) # Which way its text runs
    madeFor: string(max=50) # The console version the pack was translated against. Empty when the file did not say
    catalog: record(string, unknown) # The strings, nested by namespace and then by key, in the English catalog's shape. Every value is text or a further level of nesting
}

# A language the console can be shown in on this station, without its strings
contract ConsoleLanguage: {
    locale: string(min=2, max=35)
    name: string(min=1, max=100)
    direction: enum(ltr, rtl)
    madeFor: string(max=50)
    importedAt: datetime # When the pack now installed for it was imported
}

contract ConsoleLanguageList: {
    languages: array(ConsoleLanguage) # In order of their tags. English is built in and is never listed
}

# The language the signed-in operator chose for the console. Absent means none was chosen, and the console follows the browser's own preference among the languages it has
contract ConsoleLanguageChoice: {
    locale?: string(min=2, max=35) # A language this station holds a pack for, or `en` for English whatever the browser prefers
}
