namespace MaroonedSoftware.Deadair.Desktop.Core.Settings;

/// <summary>What kind of box a plugin's setting is drawn as.</summary>
/// <remarks>
/// Fewer kinds than the plugin contract declares, because this is what the FORM can draw rather than
/// what a manifest may say. A plugin declaring something not in this list is refused before it is
/// ever listed, so nothing here has to have an opinion about it.
/// </remarks>
public enum FieldKind
{
    /// <summary>One line.</summary>
    Line,

    /// <summary>Several.</summary>
    Text,

    /// <summary>On or off, travelling as the word.</summary>
    Boolean,
}

/// <summary>
/// One setting a plugin declared, in the shape the app's own form draws.
/// </summary>
/// <remarks>
/// The plugin contract's own field type is not used here, because Core would then have to reference
/// it and the settings page would be one recompile away from every change to the plugin API. This is
/// the app's own, small, and it is what the two sides agree on.
/// </remarks>
/// <param name="Key">How the plugin reads it back.</param>
/// <param name="Label">What the operator sees beside the box.</param>
/// <param name="Help">A sentence under it, where the reason for a setting goes.</param>
/// <param name="Kind">What to draw.</param>
/// <param name="Default">What the plugin gets when nobody sets it. A string, like everything else.</param>
public sealed record FieldSpec(string Key, string Label, string? Help, FieldKind Kind, string? Default);
