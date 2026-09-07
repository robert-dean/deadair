using System.Globalization;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// One station setting, drawn from what the station said about it.
/// </summary>
/// <remarks>
/// <para>
/// Nothing here knows what any particular setting means. The station declares its key, label, type,
/// bounds and help, and this renders whatever it declared — which is why adding a setting to the
/// station adds it to this app with no code at all.
/// </para>
/// <para>
/// <b>Every value travels as a STRING.</b> That is the station's own rule rather than a convenience:
/// every layer of its configuration holds text, so an on/off setting is the word `true` and a number
/// is its digits. Sending a JSON boolean would be sending a shape the station does not store.
/// </para>
/// </remarks>
public sealed partial class SettingFieldViewModel : ObservableObject
{
    private readonly string? _original;

    public SettingFieldViewModel(StationSettingDescriptor descriptor, JsonElement? value, bool configured)
    {
        ArgumentNullException.ThrowIfNull(descriptor);

        Descriptor = descriptor;
        Key = descriptor.Key;
        Label = descriptor.Label;
        Help = descriptor.Help;
        Group = descriptor.Group.ToString();
        IsSecret = descriptor.Type == ConfigFieldType.Secret;
        IsBoolean = descriptor.Type == ConfigFieldType.Boolean;

        _original = Read(value);

        if (IsSecret)
        {
            // A secret is reported as a configured-boolean and never as a value, so there is nothing
            // to prefill. An empty box means "leave it alone" rather than "clear it".
            Text = string.Empty;
            SecretState = configured ? "Set. Type a new one to replace it." : "Not set.";
        }
        else
        {
            Text = _original ?? string.Empty;
        }

        Switch = IsOn(_original);
    }

    public StationSettingDescriptor Descriptor { get; }

    public string Key { get; }

    public string Label { get; }

    public string? Help { get; }

    public string Group { get; }

    public bool IsSecret { get; }

    public bool IsBoolean { get; }

    public bool IsText => !IsBoolean;

    public string? SecretState { get; }

    [ObservableProperty]
    private string _text = string.Empty;

    [ObservableProperty]
    private bool _switch;

    /// <summary>Whether this field has something worth sending.</summary>
    /// <remarks>
    /// A secret left blank is skipped rather than sent as an empty string, which would clear it.
    /// Everything else is sent only when it differs from what the station last said.
    /// </remarks>
    public bool IsDirty => IsSecret
        ? Text.Length > 0
        : !string.Equals(Current, _original ?? string.Empty, StringComparison.Ordinal);

    /// <summary>What to send, as the string the station stores.</summary>
    public string Current => IsBoolean
        ? Switch ? "true" : "false"
        : Text;

    /// <summary>
    /// Reads the station's current value as text, whatever JSON shape it arrived in.
    /// </summary>
    /// <remarks>
    /// It is stored as text and usually sent as text, but a number or a boolean coming back as its
    /// JSON form is not worth failing over — `ToString` on the element would wrap a string in quotes,
    /// which is how a setting acquires a pair of them.
    /// </remarks>
    private static string? Read(JsonElement? value) => value switch
    {
        null => null,
        { ValueKind: JsonValueKind.String } element => element.GetString(),
        { ValueKind: JsonValueKind.True } => "true",
        { ValueKind: JsonValueKind.False } => "false",
        { ValueKind: JsonValueKind.Null or JsonValueKind.Undefined } => null,
        { } element => element.ToString(),
    };

    /// <summary>
    /// The station's own vocabulary for a switch.
    /// </summary>
    /// <remarks>
    /// `config.get(key, false)` answers the STRING `'false'`, which is truthy — a bug that was live in
    /// six places at once on the station. Anything unparseable takes the declared default rather than
    /// falling to off, because a value nobody can read is a value nobody set.
    /// </remarks>
    private bool IsOn(string? value)
    {
        if (value is null)
        {
            return DefaultIsOn();
        }

        return value.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" => true,
            "false" or "0" or "no" or "off" => false,
            _ => DefaultIsOn(),
        };
    }

    /// <remarks>
    /// The default is a small union rather than a string, so it is matched rather than stringified:
    /// `ToString` on the record gives `OfBoolean { Value = True }`, which parses as nothing.
    /// </remarks>
    private bool DefaultIsOn() => Descriptor.Default switch
    {
        ConfigFieldDescriptorDefault.OfBoolean boolean => boolean.Value,
        ConfigFieldDescriptorDefault.OfString text =>
            text.Value.Trim().ToLowerInvariant() is "true" or "1" or "yes" or "on",
        ConfigFieldDescriptorDefault.OfNumber number => number.Value != 0,
        _ => false,
    };
}
