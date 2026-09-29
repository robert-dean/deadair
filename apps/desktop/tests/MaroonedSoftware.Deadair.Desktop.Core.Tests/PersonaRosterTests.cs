using System.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The roster as the Characters tab draws it, and the files a roster travels in.
/// </summary>
/// <remarks>
/// The order is the page saying which card matters: the character somebody can hear, then the
/// station's own host, and callers after every host. And a file that is not a persona file has to be
/// caught here, where it can be named, rather than refused by a schema that never saw it.
/// </remarks>
public class PersonaRosterTests
{
    [Fact]
    public void WhoeverIsSpeakingLeads_ThenTheStationsOwn_ThenHosts_ThenCallers()
    {
        var order = PersonaRoster.Order(
        [
            Persona("caller", kind: PersonaKind.Caller),
            Persona("plain"),
            Persona("own", defaultHost: true),
            Persona("speaking", presenting: true),
        ]);

        Assert.Equal(["speaking", "own", "plain", "caller"], order.Select(persona => persona.Key));
    }

    [Fact]
    public void AFilterFindsByNameKeyStyleOrOnAirName_IgnoringCase()
    {
        var marla = Persona("marla") with { DjName = "Midnight Marla", Style = "dry and unhurried" };

        Assert.True(PersonaRoster.Matches(marla, "MIDNIGHT"));
        Assert.True(PersonaRoster.Matches(marla, "unhurried"));
        Assert.True(PersonaRoster.Matches(marla, "  "));
        Assert.False(PersonaRoster.Matches(marla, "newsreader"));
    }

    [Fact]
    public void AFullyEquippedCharacterCarriesNoSummary_AndACallerIsNotAskedForPhrasings()
    {
        var equipped = Persona("a") with { Templates = "That was {{previous.title}}.", DictionMarkers = ["mm"], Voice = "v" };
        var caller = Persona("b", kind: PersonaKind.Caller) with { DictionMarkers = ["mate"], Voice = "v" };

        Assert.Null(PersonaRoster.Summary(equipped));
        Assert.Null(PersonaRoster.Summary(caller));
    }

    [Fact]
    public void ACallerNamesTheHostsItRings_SkippingOnesThatAreGone()
    {
        var host = Persona("host") with { Id = "h", Label = "Marla" };
        var caller = Persona("caller", kind: PersonaKind.Caller) with { Hosts = ["h", "gone"] };

        Assert.Equal("Rings in to Marla", PersonaRoster.RingsIn(caller, [host, caller]));
        Assert.Null(PersonaRoster.RingsIn(host, [host, caller]));
    }

    [Theory]
    [InlineData("attachment; filename=\"personas-radio.json\"", "personas-radio.json")]
    [InlineData("attachment; filename=\"../../etc/marla.json\"", "marla.json")]
    [InlineData(null, "fallback.json")]
    [InlineData("attachment", "fallback.json")]
    public void AnExportIsNamedByTheStation_ButNeverChoosesWhereItGoes(string? header, string expected) =>
        Assert.Equal(expected, PersonaRoster.FileName(header, "fallback.json"));

    [Fact]
    public void AFileThatIsNotJsonIsNotAPersonaFile()
    {
        Assert.Null(PersonaRoster.Read(Encoding.UTF8.GetBytes("not json at all")));
    }

    [Fact]
    public void AnExportReadsBackAsTheFileItWas()
    {
        var file = new PersonaFile
        {
            Format = "deadair.personas/1",
            TakenAt = "2026-09-29T10:00:00Z",
            Personas = [new() { Key = "marla", Label = "Marla", Style = "dry", Stories = [] }],
        };

        var read = PersonaRoster.Read(PersonaRoster.Serialize(file));

        Assert.NotNull(read);
        Assert.Equal("marla", read.Personas[0].Key);
    }

    [Fact]
    public void TheImportButtonSaysWhatItWillDo()
    {
        Assert.Equal("Import 2 characters", PersonaRoster.ImportLabel(Plan(PersonaImportEntryOutcome.Create, PersonaImportEntryOutcome.Create)));
        Assert.Equal("Rewrite 1 character", PersonaRoster.ImportLabel(Plan(PersonaImportEntryOutcome.Update)));
        Assert.Equal("Import 1, rewrite 1", PersonaRoster.ImportLabel(Plan(PersonaImportEntryOutcome.Create, PersonaImportEntryOutcome.Update)));
    }

    private static PersonaImportPlan Plan(params PersonaImportEntryOutcome[] outcomes) => new()
    {
        Format = "deadair.personas/1",
        Notices = [],
        Personas = outcomes.Select((outcome, index) => new PersonaImportEntry
        {
            Key = $"k{index}",
            Label = $"L{index}",
            Outcome = outcome,
            StoriesNew = 0,
            StoriesHeld = 0,
            DetailsNew = 0,
            DetailsHeld = 0,
            Notices = [],
        }).ToList(),
    };

    private static Persona Persona(string key, PersonaKind? kind = null, bool defaultHost = false, bool presenting = false) => new()
    {
        Id = key,
        Key = key,
        Label = key,
        Style = key,
        Kind = kind,
        DefaultHost = defaultHost,
        Presenting = presenting,
    };
}
