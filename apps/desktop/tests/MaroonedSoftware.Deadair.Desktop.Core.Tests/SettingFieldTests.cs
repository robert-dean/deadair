using System.Text.Json;
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
}
