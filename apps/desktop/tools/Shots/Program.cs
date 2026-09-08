using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Headless;
using Avalonia.Markup.Xaml.MarkupExtensions;
using Avalonia.Media.Imaging;
using Avalonia.Styling;
using Avalonia.Threading;
using MaroonedSoftware.Deadair.Desktop;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Themes;

namespace Shots;

// Renders a page to a PNG without a screen.
//
// The desktop app is verified by running it, and everything except how it LOOKS can be checked that
// way. This closes the rest: it boots Avalonia on the headless platform with real Skia drawing,
// builds a page with representative data, and writes what it drew.
//
// Not a test. It asserts nothing and cannot fail meaningfully — a layout is judged by looking at it,
// which is exactly the thing an assertion cannot do.
//
//     dotnet run --project apps/desktop/tools/Shots -- artifacts/shots [light|dark]
internal static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        var into = args.Length > 0 ? args[0] : "artifacts/shots";
        // `Default` follows the host, which headless does not have, so a shot names its appearance
        // rather than inheriting one. Without this every frame renders light and the dark half of
        // the app goes unlooked-at.
        var appearance = args.Length > 1 && Enum.TryParse<Appearance>(args[1], ignoreCase: true, out var parsed)
            ? parsed
            : Appearance.Dark;

        Directory.CreateDirectory(into);

        AppBuilder.Configure<App>()
            .UseSkia()
            .UseHeadless(new AvaloniaHeadlessPlatformOptions
            {
                // The whole point: real drawing rather than the headless stub, so what comes out is
                // what a screen would show.
                UseHeadlessDrawing = false,
            })
            .AfterSetup(_ => Render(into, appearance))
            .SetupWithoutStarting();
    }

    private static void Render(string into, Appearance appearance)
    {
        if (Application.Current is { } application)
        {
            application.RequestedThemeVariant = appearance is Appearance.Light
                ? ThemeVariant.Light
                : ThemeVariant.Dark;
        }

        foreach (var (name, page, width, height) in Pages.All())
        {
            Save(Path.Combine(into, $"{name}-{appearance.ToString().ToLowerInvariant()}.png"), page, width, height);
        }
    }

    private static void Save(string path, Control page, int width, int height)
    {
        // The app's own window paints this; a shot taken without it shows every page on the
        // platform default, which is white — so a dark theme's page looked like it had a white
        // margin around it and the light theme looked whiter than it is.
        var window = new Window
        {
            Width = width,
            Height = height,
            WindowDecorations = WindowDecorations.None,
            Content = page,
            [!TemplatedControl.BackgroundProperty] = new DynamicResourceExtension("DaBgBrush"),
        };

        // The desk's operator column names the WINDOW's DataContext, deliberately: setting one on a
        // child re-scopes every binding on it. So a shell frame has to put the shell on the window
        // too, or those bindings silently fail and every `IsVisible` bound through them defaults to
        // true — which is a frame showing Skip, Stop and Start at once and an empty card on a page
        // with no operator.
        if (page is MainWindowContent shell)
        {
            window.DataContext = shell.DataContext;
        }

        window.Show();

        // Three times, deliberately. The first pass measures and arranges; a frame captured before
        // the second is a half-laid-out page, which looks like a bug in the page rather than in
        // this. The third is for the desk, whose cover is sized in code from the room the page
        // turned out to have — that answer only exists once a pass has run, and setting it asks for
        // another. On screen the same settling happens across frames and is invisible.
        Dispatcher.UIThread.RunJobs();
        Dispatcher.UIThread.RunJobs();
        Dispatcher.UIThread.RunJobs();

        var frame = window.CaptureRenderedFrame();
        frame?.Save(path, new PngBitmapEncoderOptions());

        window.Close();
        Console.WriteLine(frame is null ? $"no frame for {path}" : $"wrote {path}");
    }
}
