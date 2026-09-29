using MaroonedSoftware.Deadair.Desktop.Core.Forms;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The rows of a list field, and the credentials some of them hold.
/// </summary>
/// <remarks>
/// The rule that cost an incident on the web console: a row that can hold a credential needs its id
/// before its first save, or the next save reads it as a new row and deletes the key typed a minute
/// before.
/// </remarks>
public class FormRowsTests
{
    private static readonly ConfigFieldColumn Name = new() { Key = "name", Label = "Name", Type = ConfigFieldColumnType.String };
    private static readonly ConfigFieldColumn Kind = new() { Key = "kind", Label = "Kind", Type = ConfigFieldColumnType.Select };
    private static readonly ConfigFieldColumn Key = new() { Key = "key", Label = "Key", Type = ConfigFieldColumnType.Secret };

    private static readonly ConfigFieldColumn Url = new()
    {
        Key = "url",
        Label = "Address",
        Type = ConfigFieldColumnType.Url,
        DependsOn = "kind",
        DependsOnValues = ["self-hosted"],
    };

    [Fact]
    public void ARowThatCanHoldACredentialIsBornWithItsId()
    {
        Assert.True(FormRows.Empty([Name, Key]).ContainsKey(FormRows.RowIdKey));
        Assert.False(FormRows.Empty([Name]).ContainsKey(FormRows.RowIdKey));
    }

    [Fact]
    public void AStoredRowKeepsItsIdAndAnOldOneIsGivenOne()
    {
        var rows = FormRows.Parse("""[{"$id":"abc","name":"A"},{"name":"B"}]""", [Name, Key]);

        Assert.Equal("abc", rows[0][FormRows.RowIdKey]);
        Assert.False(string.IsNullOrEmpty(rows[1][FormRows.RowIdKey]));
    }

    [Fact]
    public void AnIdCanNeverHoldTheSlashThatAddressesASecret()
    {
        for (var i = 0; i < 200; i++)
        {
            Assert.DoesNotContain('/', FormRows.MintRowId());
        }
    }

    [Fact]
    public void ASecretCellLeftBlankIsLeftOutSoTheStoredOneIsKept()
    {
        var sent = FormRows.Submit(
            [new Dictionary<string, string> { [FormRows.RowIdKey] = "abc", ["name"] = "Renamed", ["key"] = string.Empty }],
            [Name, Key],
            "providers",
            new HashSet<string>());

        Assert.Equal("""[{"$id":"abc","name":"Renamed"}]""", sent);
    }

    [Fact]
    public void ASecretCellAskedToGoIsSentAsNull()
    {
        var sent = FormRows.Submit(
            [new Dictionary<string, string> { [FormRows.RowIdKey] = "abc", ["name"] = "A", ["key"] = string.Empty }],
            [Name, Key],
            "providers",
            new HashSet<string> { FormRows.SecretKey("providers", "abc", "key") });

        Assert.Equal("""[{"$id":"abc","name":"A","key":null}]""", sent);
    }

    [Fact]
    public void ACellThatDoesNotApplyToItsRowIsNotSent()
    {
        // An address left behind by a change of kind would otherwise be read into the plugin's allowlist.
        var sent = FormRows.Submit(
            [new Dictionary<string, string> { ["kind"] = "vendor", ["url"] = "https://stale.example" }],
            [Kind, Url],
            "providers",
            new HashSet<string>());

        Assert.Equal("""[{"kind":"vendor"}]""", sent);
    }

    [Fact]
    public void ACellWhoseTargetIsStillEmptyApplies()
    {
        // The row just added has every cell empty, and is the one most in need of filling in.
        Assert.True(FormRows.AppliesToRow(Url, [Kind, Url], new Dictionary<string, string> { ["kind"] = string.Empty }));
    }

    [Fact]
    public void APresetNeverFillsASecret()
    {
        var row = FormRows.From([Name, Key], new ConfigFieldPreset { Label = "p", Cells = new() { ["name"] = "N", ["key"] = "leaked" } });

        Assert.Equal("N", row["name"]);
        Assert.Equal(string.Empty, row["key"]);
    }

    [Fact]
    public void ARowOfOnlyAnIdIsBlank() =>
        Assert.True(FormRows.IsBlank(new Dictionary<string, string> { [FormRows.RowIdKey] = "abc", ["name"] = "  " }));

    [Fact]
    public void AHandEditedValueCostsTheFieldRatherThanThePage() =>
        Assert.Empty(FormRows.Parse("not json", [Name]));
}
