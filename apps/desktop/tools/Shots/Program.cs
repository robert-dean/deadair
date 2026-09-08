using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Headless;
using Avalonia.Markup.Xaml.MarkupExtensions;
using Avalonia.Media.Imaging;
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
//     dotnet run --project apps/desktop/tools/Shots -- artifacts/shots [theme]
internal static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        var into = args.Length > 0 ? args[0] : "artifacts/shots";
        var theme = args.Length > 1 && Enum.TryParse<ThemeId>(args[1], ignoreCase: true, out var parsed)
            ? parsed
            : ThemeId.Carbon;

        Directory.CreateDirectory(into);

        AppBuilder.Configure<App>()
            .UseSkia()
            .UseHeadless(new AvaloniaHeadlessPlatformOptions
            {
                // The whole point: real drawing rather than the headless stub, so what comes out is
                // what a screen would show.
                UseHeadlessDrawing = false,
            })
            .AfterSetup(_ => Render(into, theme))
            .SetupWithoutStarting();
    }

    private static void Render(string into, ThemeId theme)
    {
        if (Application.Current is { } application)
        {
            application.RequestedThemeVariant = ConsoleThemes.For(theme);
        }

        foreach (var (name, page) in Pages.All())
        {
            Save(Path.Combine(into, $"{name}-{theme.ToString().ToLowerInvariant()}.png"), page);
        }
    }

    private static void Save(string path, Control page)
    {
        // The app's own window paints this; a shot taken without it shows every page on the
        // platform default, which is white — so a dark theme's page looked like it had a white
        // margin around it and the light theme looked whiter than it is.
        var window = new Window
        {
            Width = 1180,
            Height = 720,
            WindowDecorations = WindowDecorations.None,
            Content = page,
            [!TemplatedControl.BackgroundProperty] = new DynamicResourceExtension("DaBgBrush"),
        };

        window.Show();

        // Twice, deliberately. The first pass measures and arranges; a frame captured before the
        // second is a half-laid-out page, which looks like a bug in the page rather than in this.
        Dispatcher.UIThread.RunJobs();
        Dispatcher.UIThread.RunJobs();

        var frame = window.CaptureRenderedFrame();
        frame?.Save(path, new PngBitmapEncoderOptions());

        window.Close();
        Console.WriteLine(frame is null ? $"no frame for {path}" : $"wrote {path}");
    }
}
