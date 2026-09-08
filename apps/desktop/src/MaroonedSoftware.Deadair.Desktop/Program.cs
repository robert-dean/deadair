using Avalonia;

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
        var builder = BuildAvaloniaApp();
        builder.StartWithClassicDesktopLifetime(args);

        // After the loop, not during shutdown. The pollers stop here, and blocking is safe because
        // there is no dispatcher left to starve — see `App.DisposeServicesAsync` for what closing the
        // window used to do instead.
        if (builder.Instance is App app)
        {
            app.DisposeServicesAsync().AsTask().GetAwaiter().GetResult();
        }
    }

    /// <summary>Used by the visual designer as well as by <see cref="Main"/>, so it stays parameterless.</summary>
    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>()
        .UsePlatformDetect()
        .LogToTrace();
}
