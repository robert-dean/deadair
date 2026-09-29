using System.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// A console language pack read from a file, and the console's reasons for refusing one.
/// </summary>
/// <remarks>
/// The same file must be refused here and in the console for the same stated reason, or somebody
/// told "not a pack" by one and "made for a newer console" by the other has two stories about one
/// file. English is refused outright, because every other language falls back to it key by key and a
/// replaced English leaves nothing to fall back to.
/// </remarks>
public class LanguagePacksTests
{
    private static (ConsoleLanguagePack? Pack, string? Problem) Read(string json) =>
        LanguagePacks.Read(Encoding.UTF8.GetBytes(json), "pack.json");

    [Fact]
    public void APackIsReadWithItsLocaleInCanonicalCase()
    {
        var (pack, problem) = Read("""
            { "format": "deadair.console-language", "version": 1, "locale": "pt_br", "name": " Português ",
              "direction": "ltr", "madeFor": "4.12.0", "catalog": { "shell:title": "Configurações" } }
            """);

        Assert.Null(problem);
        Assert.Equal("pt-BR", pack!.Locale);
        Assert.Equal("Português", pack.Name);
        Assert.Equal(ConsoleLanguagePackDirection.Ltr, pack.Direction);
        Assert.Equal("Configurações", pack.Catalog["shell:title"].GetString());
    }

    [Theory]
    [InlineData("not json at all", "is not a JSON file")]
    [InlineData("""{ "format": "something else" }""", "is not a console language pack")]
    [InlineData("""{ "format": "deadair.console-language", "version": 2 }""", "made for a newer console")]
    [InlineData("""{ "format": "deadair.console-language", "version": 1, "locale": "1x" }""", "does not say which language")]
    [InlineData("""{ "format": "deadair.console-language", "version": 1, "locale": "en-GB" }""", "is an English pack")]
    [InlineData("""{ "format": "deadair.console-language", "version": 1, "locale": "de", "name": "" }""", "does not give its language a name")]
    [InlineData("""{ "format": "deadair.console-language", "version": 1, "locale": "de", "name": "Deutsch", "direction": "up" }""", "left to right or right to left")]
    [InlineData("""{ "format": "deadair.console-language", "version": 1, "locale": "de", "name": "Deutsch", "direction": "ltr" }""", "holds no strings")]
    public void AFileThatIsNotAPackIsRefusedForTheConsolesReason(string json, string reason)
    {
        var (pack, problem) = Read(json);

        Assert.Null(pack);
        Assert.Contains(reason, problem, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("zh-hant-tw", "zh-Hant-TW")]
    [InlineData("DE", "de")]
    [InlineData("x", null)]
    [InlineData("de--at", null)]
    public void ALanguageTagIsPutInItsCanonicalCase(string tag, string? expected) => Assert.Equal(expected, LanguagePacks.Locale(tag));
}
