using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Forms;

/// <summary>
/// One field of a form the station declared, whoever declared it.
/// </summary>
/// <remarks>
/// The station's own settings and a plugin's configuration arrive as two records of the same shape
/// (<see cref="StationSettingDescriptor"/> carries a group as well), and a form that took either would
/// be two forms. This is the one shape both become, so there is one renderer and it cannot drift into
/// showing a secret on one of them.
/// </remarks>
public sealed record FormField
{
    public required string Key { get; init; }

    public required string Label { get; init; }

    public required ConfigFieldType Type { get; init; }

    public string? Help { get; init; }

    public bool Required { get; init; }

    public ConfigFieldDescriptorDefault? Default { get; init; }

    public ConfigFieldUnit? Unit { get; init; }

    public ConfigFieldControl? Control { get; init; }

    public double? Step { get; init; }

    public double? Min { get; init; }

    public double? Max { get; init; }

    public string? Placeholder { get; init; }

    public IReadOnlyList<ConfigFieldOption> Options { get; init; } = [];

    public ConfigFieldOptionSource? OptionsFrom { get; init; }

    public IReadOnlyList<ConfigFieldColumn> Columns { get; init; } = [];

    public IReadOnlyList<ConfigFieldPreset> Presets { get; init; } = [];

    /// <summary>The key of the field this one only matters once answered.</summary>
    public string? DependsOn { get; init; }

    /// <summary>The station's grouping, for its own settings. Null for a plugin's.</summary>
    public SettingGroup? Group { get; init; }

    public static FormField From(StationSettingDescriptor descriptor)
    {
        ArgumentNullException.ThrowIfNull(descriptor);

        return new FormField
        {
            Key = descriptor.Key,
            Label = descriptor.Label,
            Type = descriptor.Type,
            Help = descriptor.Help,
            Required = descriptor.Required == true,
            Default = descriptor.Default,
            Unit = descriptor.Unit,
            Control = descriptor.Control,
            Step = descriptor.Step,
            Min = descriptor.Min,
            Max = descriptor.Max,
            Placeholder = descriptor.Placeholder,
            Options = descriptor.Options ?? [],
            OptionsFrom = descriptor.OptionsFrom,
            Columns = descriptor.Columns ?? [],
            Presets = descriptor.Presets ?? [],
            DependsOn = descriptor.DependsOn,
            Group = descriptor.Group,
        };
    }

    public static FormField From(ConfigFieldDescriptor descriptor)
    {
        ArgumentNullException.ThrowIfNull(descriptor);

        return new FormField
        {
            Key = descriptor.Key,
            Label = descriptor.Label,
            Type = descriptor.Type,
            Help = descriptor.Help,
            Required = descriptor.Required == true,
            Default = descriptor.Default,
            Unit = descriptor.Unit,
            Control = descriptor.Control,
            Step = descriptor.Step,
            Min = descriptor.Min,
            Max = descriptor.Max,
            Placeholder = descriptor.Placeholder,
            Options = descriptor.Options ?? [],
            OptionsFrom = descriptor.OptionsFrom,
            Columns = descriptor.Columns ?? [],
            Presets = descriptor.Presets ?? [],
            DependsOn = descriptor.DependsOn,
        };
    }

    /// <summary>A slider is drawn only for a field that asked for one AND declared both ends.</summary>
    /// <remarks>
    /// `control` is an ask, and a slider with an open end has no track: without both bounds it is a
    /// number box, as the web console draws it.
    /// </remarks>
    public bool IsSlider => Control == ConfigFieldControl.Slider && Min is not null && Max is not null;

    /// <summary>A comma-separated line drawn as a set of entries.</summary>
    public bool IsTags => Control == ConfigFieldControl.Tags;
}
