using System.Text.Json.Serialization;

namespace MaroonedSoftware.Deadair.Desktop.Core.Settings;

/// <summary>When Studio keeps the display awake. The Android and iOS apps' setting, value for value.</summary>
/// <remarks>
/// Never by default: a display that will not sleep is power spent on a picture, and somebody who wants
/// the cover up across the room all evening can say so. Written as a NAME, for the reason
/// <see cref="Appearance"/> is.
/// </remarks>
[JsonConverter(typeof(JsonStringEnumConverter<KeepAwake>))]
public enum KeepAwake
{
    /// <summary>The display sleeps on the Mac's own timer, as for any other app.</summary>
    Never,

    /// <summary>Awake while the Mac is on mains power, which a desktop Mac always is.</summary>
    WhileCharging,

    /// <summary>Awake whatever the battery says.</summary>
    Always,
}

/// <summary>Whether the display is held awake right now.</summary>
public static class KeepAwakeRule
{
    /// <summary>
    /// All of three things: the setting allows it (on power, for <see cref="KeepAwake.WhileCharging"/>),
    /// this app is playing, and Studio is up where it can be seen.
    /// </summary>
    /// <remarks>
    /// Studio rather than the window, because Studio is the screen made to be looked at from across a
    /// room; a page of the desk is something somebody is working in, and they will touch it. A Studio
    /// behind another app's Space is not in front, because a display held awake for a window nobody
    /// can see is the cost with none of the picture. The Android app's <c>keepAwake</c>, case for case.
    /// </remarks>
    public static bool Holds(KeepAwake setting, bool onPower, bool playing, bool inFront)
    {
        var allowed = setting switch
        {
            KeepAwake.WhileCharging => onPower,
            KeepAwake.Always => true,
            _ => false,
        };

        return allowed && playing && inFront;
    }
}
