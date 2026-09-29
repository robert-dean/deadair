using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Forms;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// A form drawn from what the station or a plugin declared, and what it sends back.
/// </summary>
/// <remarks>
/// Every rule here is one the station already holds a client to. A setting is a STRING, so a
/// switch travels as the word; a plugin's config is stored as sent, so there it travels as a boolean.
/// A secret is never prefilled, and an empty box leaves it alone. Only what changed is sent, because
/// the write is partial and sending everything overwrites what somebody else changed.
/// </remarks>
public class ConfigFormTests
{
    private static JsonElement Json(string raw) => JsonSerializer.Deserialize<JsonElement>(raw);

    private static FormField Field(string key, ConfigFieldType type, ConfigFieldDescriptorDefault? fallback = null) =>
        new() { Key = key, Label = key, Type = type, Default = fallback };

    private static ConfigFormViewModel Form(
        FormEncoding encoding,
        IReadOnlyDictionary<string, JsonElement> stored,
        params FormField[] fields) =>
        new(fields, stored, new Dictionary<string, bool>(), encoding);

    [Fact]
    public void AStationSwitchIsSentAsTheWordRatherThanABoolean()
    {
        var form = Form(FormEncoding.Strings, new Dictionary<string, JsonElement> { ["on"] = Json("\"false\"") }, Field("on", ConfigFieldType.Boolean));
        var field = Assert.IsType<BooleanFormFieldViewModel>(form.Fields[0]);

        field.Switch = true;

        Assert.Equal(JsonValueKind.String, form.Submission()["on"].ValueKind);
        Assert.Equal("true", form.Submission()["on"].GetString());
    }

    [Fact]
    public void APluginSwitchIsSentAsTheBooleanItIsStoredAs()
    {
        // A plugin's config is stored exactly as sent and read as a boolean, so the word would be a
        // string the plugin reads as truthy whatever it says.
        var form = Form(FormEncoding.Typed, new Dictionary<string, JsonElement> { ["on"] = Json("false") }, Field("on", ConfigFieldType.Boolean));
        var field = Assert.IsType<BooleanFormFieldViewModel>(form.Fields[0]);

        field.Switch = true;

        Assert.Equal(JsonValueKind.True, form.Submission()["on"].ValueKind);
    }

    [Fact]
    public void APluginNumberIsSentAsANumber()
    {
        var form = Form(FormEncoding.Typed, new Dictionary<string, JsonElement> { ["n"] = Json("5") }, Field("n", ConfigFieldType.Number));
        var field = Assert.IsType<NumberFormFieldViewModel>(form.Fields[0]);

        field.Text = "7";

        Assert.Equal(7, form.Submission()["n"].GetDouble());
    }

    [Theory]
    [InlineData("\"true\"", true)]
    [InlineData("\"1\"", true)]
    [InlineData("\"yes\"", true)]
    [InlineData("\"on\"", true)]
    [InlineData("\"false\"", false)]
    [InlineData("\"0\"", false)]
    [InlineData("\"no\"", false)]
    [InlineData("\"off\"", false)]
    [InlineData("true", true)]
    public void ReadsTheStationsWholeVocabularyForOnAndOff(string stored, bool expected)
    {
        var form = Form(FormEncoding.Strings, new Dictionary<string, JsonElement> { ["on"] = Json(stored) }, Field("on", ConfigFieldType.Boolean));

        Assert.Equal(expected, Assert.IsType<BooleanFormFieldViewModel>(form.Fields[0]).Switch);
    }

    [Fact]
    public void AValueNobodyCanParseTakesTheDeclaredDefault()
    {
        // Not "off". A value nobody can read is a value nobody set, which is the station's own rule.
        var form = Form(
            FormEncoding.Strings,
            new Dictionary<string, JsonElement> { ["on"] = Json("\"perhaps\"") },
            Field("on", ConfigFieldType.Boolean, new ConfigFieldDescriptorDefault.OfBoolean(true)));

        Assert.True(Assert.IsType<BooleanFormFieldViewModel>(form.Fields[0]).Switch);
    }

    [Fact]
    public void ReadsADefaultThatArrivedAsABooleanRatherThanAString()
    {
        // The default is a small union, so stringifying the record gives `OfBoolean { Value = True }`
        // and parses as nothing.
        var form = Form(FormEncoding.Strings, new Dictionary<string, JsonElement>(), Field("on", ConfigFieldType.Boolean, new ConfigFieldDescriptorDefault.OfBoolean(true)));

        Assert.True(Assert.IsType<BooleanFormFieldViewModel>(form.Fields[0]).Switch);
    }

    [Fact]
    public void ASecretIsNeverPrefilledAndABlankBoxChangesNothing()
    {
        var form = new ConfigFormViewModel(
            [Field("key", ConfigFieldType.Secret)],
            new Dictionary<string, JsonElement>(),
            new Dictionary<string, bool> { ["key"] = true },
            FormEncoding.Strings);
        var field = Assert.IsType<SecretFormFieldViewModel>(form.Fields[0]);

        Assert.Equal(string.Empty, field.Text);
        Assert.True(field.Stored);
        Assert.Empty(form.Submission());

        field.Text = "a new one";

        Assert.Equal("a new one", form.Submission()["key"].GetString());
    }

    [Fact]
    public void RemovingASecretSendsNullRatherThanAnEmptyString()
    {
        // An empty string is what a half-typed box looks like; clearing is a deliberate act.
        var form = new ConfigFormViewModel(
            [Field("key", ConfigFieldType.Secret)],
            new Dictionary<string, JsonElement>(),
            new Dictionary<string, bool> { ["key"] = true },
            FormEncoding.Strings);
        var field = Assert.IsType<SecretFormFieldViewModel>(form.Fields[0]);

        field.ToggleClearedCommand.Execute(null);

        Assert.Equal(JsonValueKind.Null, form.Submission()["key"].ValueKind);
    }

    [Fact]
    public void OnlyChangedTextIsWorthSending()
    {
        var form = Form(FormEncoding.Strings, new Dictionary<string, JsonElement> { ["t"] = Json("\"kept\"") }, Field("t", ConfigFieldType.String));

        Assert.Empty(form.Submission());
        Assert.False(form.IsDirty);

        Assert.IsType<TextFormFieldViewModel>(form.Fields[0]).Text = "changed";

        Assert.True(form.IsDirty);
        Assert.Equal("changed", form.Submission()["t"].GetString());
    }

    [Fact]
    public void ReadsAValueTheStationSentAsRealJsonRatherThanAsText()
    {
        // `ToString` on a JSON string would wrap it in quotes, which is how a setting acquires a pair.
        var form = Form(
            FormEncoding.Strings,
            new Dictionary<string, JsonElement> { ["n"] = Json("32"), ["t"] = Json("\"plain\"") },
            Field("n", ConfigFieldType.Number),
            Field("t", ConfigFieldType.String));

        Assert.Equal("32", Assert.IsType<NumberFormFieldViewModel>(form.Fields[0]).Text);
        Assert.Equal("plain", Assert.IsType<TextFormFieldViewModel>(form.Fields[1]).Text);
    }

    [Fact]
    public void ABlankedNumberThatHadAValueIsCleared()
    {
        var form = Form(FormEncoding.Typed, new Dictionary<string, JsonElement> { ["n"] = Json("5") }, Field("n", ConfigFieldType.Number));

        Assert.IsType<NumberFormFieldViewModel>(form.Fields[0]).Text = string.Empty;

        Assert.Equal(JsonValueKind.Null, form.Submission()["n"].ValueKind);
    }

    [Fact]
    public void ASizeIsShownInGigabytesAndSentInBytes()
    {
        var field = Field("cap", ConfigFieldType.Number) with { Unit = ConfigFieldUnit.Bytes };
        var form = Form(FormEncoding.Strings, new Dictionary<string, JsonElement> { ["cap"] = Json("\"50000000000\"") }, field);
        var number = Assert.IsType<NumberFormFieldViewModel>(form.Fields[0]);

        Assert.Equal("50", number.Text);

        number.Text = "2.5";

        Assert.Equal("2500000000", form.Submission()["cap"].GetString());
    }

    [Fact]
    public void AFieldWaitsForTheOneItDependsOnAndIsNotSentMeanwhile()
    {
        var form = Form(
            FormEncoding.Strings,
            new Dictionary<string, JsonElement>(),
            Field("enabled", ConfigFieldType.Boolean),
            Field("host", ConfigFieldType.String) with { DependsOn = "enabled" });
        var host = Assert.IsType<TextFormFieldViewModel>(form.Fields[1]);

        Assert.False(host.IsVisible);
        host.Text = "typed while hidden";
        Assert.DoesNotContain("host", form.Submission().Keys);

        Assert.IsType<BooleanFormFieldViewModel>(form.Fields[0]).Switch = true;

        Assert.True(host.IsVisible);
        Assert.Equal("typed while hidden", form.Submission()["host"].GetString());
    }

    [Fact]
    public void ADependencyOnAFieldThisFormDoesNotHoldShowsTheField()
    {
        // A page drawing one group of a larger set: hiding a field because its condition is on another
        // page would be worse than showing it.
        var form = Form(FormEncoding.Strings, new Dictionary<string, JsonElement>(), Field("host", ConfigFieldType.String) with { DependsOn = "elsewhere" });

        Assert.True(form.Fields[0].IsVisible);
    }

    [Fact]
    public void ARequiredFieldLeftEmptyIsNamed()
    {
        var form = Form(FormEncoding.Strings, new Dictionary<string, JsonElement>(), Field("host", ConfigFieldType.String) with { Label = "Host", Required = true });

        Assert.Equal("Host needs an answer.", form.Problem());
    }

    [Fact]
    public void AMultiselectIsTheJsonArrayItIsStoredAs()
    {
        var field = Field("kinds", ConfigFieldType.Multiselect) with
        {
            Options = [new() { Value = "a", Label = "A" }, new() { Value = "b", Label = "B" }],
        };
        var form = Form(FormEncoding.Strings, new Dictionary<string, JsonElement> { ["kinds"] = Json("\"[\\\"a\\\"]\"") }, field);
        var chosen = Assert.IsType<MultiSelectFormFieldViewModel>(form.Fields[0]);

        Assert.True(chosen.Choices[0].IsChosen);

        chosen.Choices[1].IsChosen = true;

        Assert.Equal("[\"a\",\"b\"]", form.Submission()["kinds"].GetString());
    }

    [Fact]
    public void AValueNoSourceListsAnyMoreIsKeptAsAChoice()
    {
        // The value in force, even if a source can no longer list it: a box showing nothing would hide it.
        var field = Field("voice", ConfigFieldType.Select) with { Options = [new() { Value = "a", Label = "A" }] };
        var form = Form(FormEncoding.Strings, new Dictionary<string, JsonElement> { ["voice"] = Json("\"gone\"") }, field);
        var select = Assert.IsType<SelectFormFieldViewModel>(form.Fields[0]);

        Assert.Equal("gone", select.Chosen?.Value);
        Assert.Empty(form.Submission());
    }

    [Fact]
    public void AListIsSentAsItsRowsWithBlankRowsDropped()
    {
        var field = Field("feeds", ConfigFieldType.List) with
        {
            Columns = [new() { Key = "name", Label = "Name", Type = ConfigFieldColumnType.String }],
        };
        var form = Form(FormEncoding.Strings, new Dictionary<string, JsonElement> { ["feeds"] = Json("\"[{\\\"name\\\":\\\"One\\\"}]\"") }, field);
        var list = Assert.IsType<ListFormFieldViewModel>(form.Fields[0]);

        Assert.Empty(form.Submission());

        list.AddRowCommand.Execute(null);
        Assert.Empty(form.Submission());

        list.Rows[1].Cells[0].Text = "Two";

        Assert.Equal("[{\"name\":\"One\"},{\"name\":\"Two\"}]", form.Submission()["feeds"].GetString());
    }
}
