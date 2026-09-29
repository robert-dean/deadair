using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// A field one of this app's own plugins declared.
/// </summary>
/// <remarks>
/// The station's settings and a station plugin's configuration are <c>ConfigFormTests</c>; this is
/// the smaller shape a desktop output plugin declares, read by the station's rules all the same.
/// </remarks>
public class SettingFieldTests
{
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
            "192.0.2.36");

        Assert.Equal("players", field.Key);
        Assert.Equal("Players", field.Label);
        Assert.Equal("One per line.", field.Help);
        Assert.Equal("192.0.2.36", field.Text);
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
