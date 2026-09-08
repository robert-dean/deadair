using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// A setting is a STRING, and this is the client side of that rule.
/// </summary>
/// <remarks>
/// The station's own note on it is blunt: every layer of its configuration holds text, so
/// `config.get(key, false)` answers the string `'false'`, which is truthy — a bug that was live in
/// six places at once. A client that sent a JSON boolean would be sending a shape the station does
/// not store.
/// </remarks>
public class SettingFieldTests
{
    private static StationSettingDescriptor Descriptor(
        ConfigFieldType type,
        ConfigFieldDescriptorDefault? fallback = null) => new()
        {
            Key = "rotation.discover",
            Label = "Discover",
            Type = type,
            Group = SettingGroup.Rotation,
            Default = fallback,
        };

    private static JsonElement Json(string raw) => JsonSerializer.Deserialize<JsonElement>(raw);

    [Fact]
    public void SendsASwitchAsTheWordRatherThanABoolean()
    {
        var field = new SettingFieldViewModel(Descriptor(ConfigFieldType.Boolean), Json("\"false\""), configured: true);

        Assert.False(field.Switch);

        field.Switch = true;

        Assert.Equal("true", field.Current);
        Assert.True(field.IsDirty);
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
    public void ReadsTheStationsWholeVocabularyForOnAndOff(string stored, bool expected)
    {
        var field = new SettingFieldViewModel(Descriptor(ConfigFieldType.Boolean), Json(stored), configured: true);

        Assert.Equal(expected, field.Switch);
    }

    [Fact]
    public void AValueNobodyCanParseTakesTheDeclaredDefault()
    {
        // Not "off". A value nobody can read is a value nobody set, which is the station's own rule
        // in `settingIsOn`.
        var field = new SettingFieldViewModel(
            Descriptor(ConfigFieldType.Boolean, new ConfigFieldDescriptorDefault.OfBoolean(true)),
            Json("\"perhaps\""),
            configured: true);

        Assert.True(field.Switch);
    }

    [Fact]
    public void ReadsADefaultThatArrivedAsABooleanRatherThanAString()
    {
        // The default is a small union, so stringifying the record gives `OfBoolean { Value = True }`
        // and parses as nothing.
        var field = new SettingFieldViewModel(
            Descriptor(ConfigFieldType.Boolean, new ConfigFieldDescriptorDefault.OfBoolean(true)),
            value: null,
            configured: false);

        Assert.True(field.Switch);
    }

    [Fact]
    public void ASecretIsNeverPrefilledAndABlankBoxChangesNothing()
    {
        // A secret is reported as a configured-boolean and never as a value, so an empty box means
        // leave it alone. Sending an empty string would clear it.
        var field = new SettingFieldViewModel(Descriptor(ConfigFieldType.Secret), value: null, configured: true);

        Assert.Equal(string.Empty, field.Text);
        Assert.False(field.IsDirty);

        field.Text = "a new one";

        Assert.True(field.IsDirty);
    }

    [Fact]
    public void OnlyChangedTextIsWorthSending()
    {
        var field = new SettingFieldViewModel(Descriptor(ConfigFieldType.String), Json("\"kept\""), configured: true);

        Assert.False(field.IsDirty);

        field.Text = "changed";

        Assert.True(field.IsDirty);
    }

    [Fact]
    public void ReadsAValueTheStationSentAsRealJsonRatherThanAsText()
    {
        // Stored as text and usually sent as text, but a number coming back as a JSON number is not
        // worth failing over — and `ToString` on a JSON string would wrap it in quotes, which is how
        // a setting acquires a pair of them.
        var number = new SettingFieldViewModel(Descriptor(ConfigFieldType.Number), Json("32"), configured: true);
        var text = new SettingFieldViewModel(Descriptor(ConfigFieldType.String), Json("\"plain\""), configured: true);

        Assert.Equal("32", number.Text);
        Assert.Equal("plain", text.Text);
    }

    /// <summary>
    /// A plugin declares its settings in the same shape the station declares its own, so it gets the
    /// same form rather than one written again for it. What differs is only where the declaration
    /// came from.
    /// </summary>
    [Fact]
    public void APluginsFieldReadsLikeAStationsOwn()
    {
        var field = SettingFieldViewModel.ForPlugin(
            new FieldSpec("players", "Players", "One per line.", FieldKind.Text, null),
            "10.0.1.36");

        Assert.Equal("players", field.Key);
        Assert.Equal("Players", field.Label);
        Assert.Equal("One per line.", field.Help);
        Assert.Equal("10.0.1.36", field.Text);
        Assert.True(field.IsText);
        Assert.True(field.IsMultiline);
        Assert.False(field.IsSecret);
        Assert.False(field.IsDirty);
    }

    [Fact]
    public void APluginsUnsetFieldTakesWhatThePluginDeclared()
    {
        var field = SettingFieldViewModel.ForPlugin(
            new FieldSpec("discover", "Find players", null, FieldKind.Boolean, "true"),
            value: null);

        Assert.True(field.IsBoolean);
        Assert.True(field.Switch);
        Assert.Equal("true", field.Current);
    }

    /// <summary>
    /// The station's own rule about text, applied to a plugin's declaration: an on/off setting is
    /// the WORD, and anything unreadable takes the declared default rather than falling to off.
    /// </summary>
    [Theory]
    [InlineData("yes", true)]
    [InlineData("on", true)]
    [InlineData("0", false)]
    [InlineData("perhaps", true)]
    public void APluginsSwitchIsReadTheWayTheStationReadsOne(string value, bool expected)
    {
        var field = SettingFieldViewModel.ForPlugin(
            new FieldSpec("discover", "Find players", null, FieldKind.Boolean, "true"),
            value);

        Assert.Equal(expected, field.Switch);
    }

    [Fact]
    public void APluginsFieldKnowsWhenItWasEdited()
    {
        var field = SettingFieldViewModel.ForPlugin(
            new FieldSpec("caption", "Caption", null, FieldKind.Line, null),
            value: null);

        Assert.False(field.IsDirty);

        field.Text = "Deadair";

        Assert.True(field.IsDirty);
        Assert.Equal("Deadair", field.Current);
    }
}
