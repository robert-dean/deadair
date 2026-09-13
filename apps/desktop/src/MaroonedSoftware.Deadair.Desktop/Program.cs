using System.Diagnostics;
using System.Runtime.InteropServices;
using Avalonia;
using MaroonedSoftware.Deadair.Desktop.Core;
using MaroonedSoftware.Deadair.Desktop.Core.Diagnostics;

namespace MaroonedSoftware.Deadair.Desktop;

internal static class Program
{
    /// <remarks>
    /// <c>STAThread</c> is a Windows requirement and harmless elsewhere. What matters on macOS is
    /// that this thread becomes the one Avalonia runs its loop on, because AVFoundation is serviced
    /// by that loop and the player must be built and driven from it.
    /// </remarks>
    [STAThread]
    public static void Main(string[] args)
    {
        // First, before Avalonia: `LogToTrace` below writes through Trace, and so does everything else
        // in the app, so a listener added any later misses whatever went wrong while starting.
        var log = FileLog.Open(FileLog.DefaultDirectory());
        FileLog.Shared = log;
        var listener = log.AsTraceListener();
        Trace.Listeners.Add(listener);

        // The two ways an exception leaves without anybody catching it. Neither is handled here, only
        // written down, so the process does whatever it would have done anyway, with a record of why.
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Trace.WriteLine($"unhandled: {e.ExceptionObject}");
        TaskScheduler.UnobservedTaskException += (_, e) => Trace.WriteLine($"unobserved task: {e.Exception}");

        Trace.WriteLine($"deadair {AppVersion.Current} starting on {RuntimeInformation.OSDescription}, log at {log.FilePath}");

        var builder = BuildAvaloniaApp();
        builder.StartWithClassicDesktopLifetime(args);

        // After the loop, not during shutdown. The pollers stop here, and blocking is safe because
        // there is no dispatcher left to starve — see `App.DisposeServicesAsync` for what closing the
        // window used to do instead.
        if (builder.Instance is App app)
        {
            app.DisposeServicesAsync().AsTask().GetAwaiter().GetResult();
        }

        Trace.WriteLine("deadair exiting");
        Trace.Listeners.Remove(listener);
        log.Dispose();
    }

    /// <summary>Used by the visual designer as well as by <see cref="Main"/>, so it stays parameterless.</summary>
    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>()
        .UsePlatformDetect()
        .LogToTrace();
}
