using System.Runtime.InteropServices;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;

namespace MaroonedSoftware.Deadair.Desktop.Player.Mac;

/// <summary>
/// Reduce Motion and window occlusion, asked of AppKit through the Objective-C runtime.
/// </summary>
/// <remarks>
/// <para>
/// Two property reads, so straight through <c>objc_msgSend</c> rather than through the native shim:
/// the shim is the player's, and growing it for these would rebuild a library the player loads to
/// answer two questions that need nothing compiled.
/// </para>
/// <para>
/// Both are AppKit and so for the main thread, which in this app is the UI thread that asks them.
/// <c>BOOL</c> is one byte on Apple silicon, the only first-release target, hence <c>U1</c>.
/// </para>
/// </remarks>
public sealed partial class MacScreenFacts : IScreenFacts
{
    private const string ObjC = "/usr/lib/libobjc.A.dylib";

    /// <summary><c>NSWindowOcclusionStateVisible</c>: set while any part of the window is on screen.</summary>
    private const nuint OcclusionVisible = 1 << 1;

    private static readonly nint Workspace = GetClass("NSWorkspace");
    private static readonly nint SharedWorkspace = Selector("sharedWorkspace");
    private static readonly nint ShouldReduceMotion = Selector("accessibilityDisplayShouldReduceMotion");
    private static readonly nint OcclusionState = Selector("occlusionState");

    public bool ReduceMotion => Workspace != 0 && SendBool(Send(Workspace, SharedWorkspace), ShouldReduceMotion);

    public bool? IsSeen(nint window) => window == 0 ? null : (SendUInt(window, OcclusionState) & OcclusionVisible) != 0;

    [LibraryImport(ObjC, EntryPoint = "objc_getClass", StringMarshalling = StringMarshalling.Utf8)]
    private static partial nint GetClass(string name);

    [LibraryImport(ObjC, EntryPoint = "sel_registerName", StringMarshalling = StringMarshalling.Utf8)]
    private static partial nint Selector(string name);

    [LibraryImport(ObjC, EntryPoint = "objc_msgSend")]
    private static partial nint Send(nint receiver, nint selector);

    [LibraryImport(ObjC, EntryPoint = "objc_msgSend")]
    [return: MarshalAs(UnmanagedType.U1)]
    private static partial bool SendBool(nint receiver, nint selector);

    [LibraryImport(ObjC, EntryPoint = "objc_msgSend")]
    private static partial nuint SendUInt(nint receiver, nint selector);
}
