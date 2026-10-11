using System.Diagnostics;
using System.Runtime.InteropServices;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;

namespace MaroonedSoftware.Deadair.Desktop.Player.Mac;

/// <summary>
/// The display held awake through a power assertion, and the power source read off IOKit.
/// </summary>
/// <remarks>
/// <para>
/// Plain C calls into IOKit and CoreFoundation, so straight through P/Invoke rather than through the
/// native shim, for the reason <see cref="MacScreenFacts"/> gives: the shim is the player's.
/// </para>
/// <para>
/// <c>PreventUserIdleDisplaySleep</c> rather than <c>NoDisplaySleep</c>'s older name, and only the
/// display: the Mac is kept awake by the audio while anything plays, so asking for the system too
/// would be asking for nothing. <c>pmset -g assertions</c> lists the assertion by the name below
/// while it is held. macOS releases it when the process ends, however it ends, so a crash cannot
/// leave a display that never sleeps.
/// </para>
/// </remarks>
public sealed partial class MacDisplayAwake : IDisplayAwake
{
    private const string IoKit = "/System/Library/Frameworks/IOKit.framework/IOKit";
    private const string CoreFoundation = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";

    /// <summary><c>kCFStringEncodingUTF8</c>.</summary>
    private const uint Utf8 = 0x08000100;

    /// <summary><c>kIOPMAssertionLevelOn</c>.</summary>
    private const uint LevelOn = 255;

    private static readonly nint PreventDisplaySleep = CfString("PreventUserIdleDisplaySleep");
    private static readonly nint Reason = CfString("deadair: Studio is up and playing");

    /// <summary><c>kIOPMACPowerKey</c>, what <c>IOPSGetProvidingPowerSourceType</c> answers on mains power.</summary>
    private static readonly nint AcPower = CfString("AC Power");

    private readonly Lock _gate = new();
    private uint _assertion;
    private bool _held;

    /// <summary>
    /// On mains power, or not running from a battery at all: a desktop Mac answers AC Power, and a
    /// snapshot that cannot be had is read as on power rather than as a battery that is not there.
    /// </summary>
    public bool OnPower
    {
        get
        {
            var info = IOPSCopyPowerSourcesInfo();
            if (info == 0)
            {
                return true;
            }

            try
            {
                var source = IOPSGetProvidingPowerSourceType(info);
                return source == 0 || CFEqual(source, AcPower);
            }
            finally
            {
                CFRelease(info);
            }
        }
    }

    public void Hold(bool awake)
    {
        lock (_gate)
        {
            if (awake == _held)
            {
                return;
            }

            if (awake)
            {
                var result = IOPMAssertionCreateWithName(PreventDisplaySleep, LevelOn, Reason, out var id);
                if (result != 0)
                {
                    Trace.WriteLine($"display: could not hold it awake (IOReturn 0x{result:x})");
                    return;
                }

                _assertion = id;
                _held = true;
                Trace.WriteLine("display: held awake");
            }
            else
            {
                // Forgotten whatever the answer: an assertion the system will not release by its id is
                // one it no longer holds, and asking again would be asking about nothing.
                var released = IOPMAssertionRelease(_assertion);
                _assertion = 0;
                _held = false;
                Trace.WriteLine(released == 0 ? "display: let sleep" : $"display: release answered IOReturn 0x{released:x}");
            }
        }
    }

    public void Dispose() => Hold(false);

    private static nint CfString(string text) => CFStringCreateWithCString(0, text, Utf8);

    [LibraryImport(IoKit)]
    private static partial int IOPMAssertionCreateWithName(nint type, uint level, nint name, out uint id);

    [LibraryImport(IoKit)]
    private static partial int IOPMAssertionRelease(uint id);

    [LibraryImport(IoKit)]
    private static partial nint IOPSCopyPowerSourcesInfo();

    /// <summary>Follows the Get rule: the answer belongs to the snapshot and is not released here.</summary>
    [LibraryImport(IoKit)]
    private static partial nint IOPSGetProvidingPowerSourceType(nint snapshot);

    [LibraryImport(CoreFoundation, StringMarshalling = StringMarshalling.Utf8)]
    private static partial nint CFStringCreateWithCString(nint allocator, string text, uint encoding);

    [LibraryImport(CoreFoundation)]
    [return: MarshalAs(UnmanagedType.U1)]
    private static partial bool CFEqual(nint left, nint right);

    [LibraryImport(CoreFoundation)]
    private static partial void CFRelease(nint value);
}
