using Windows.ApplicationModel;
using Windows.ApplicationModel.Activation;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;

namespace PlayerSpike;

/// <summary>
/// Owns the one <see cref="SpikeSession"/> and decides what happens to the UI when a game takes the
/// screen.
/// </summary>
/// <remarks>
/// The console's memory limit for an app drops from about 1GB to 128MB when it goes to the
/// background, and an app over it is terminated, audio and all. So the page can be dropped on the
/// way out (<see cref="DropUiInBackground"/>) and rebuilt on the way back, and the spike reads the
/// memory both ways.
/// </remarks>
public sealed partial class App : Application
{
    public static SpikeSession Session { get; } = new();

    /// <summary>Whether to throw the page away in the background. The page offers the switch.</summary>
    public static bool DropUiInBackground { get; set; } = true;

    public App()
    {
        InitializeComponent();

        // The console shows a mouse cursor for a XAML app unless told not to, which is never what
        // a controller-driven app wants.
        RequiresPointerMode = ApplicationRequiresPointerMode.WhenRequested;

        EnteredBackground += OnEnteredBackground;
        LeavingBackground += OnLeavingBackground;
        Suspending += (_, _) => SpikeLog.Write("app: SUSPENDING (the audio did not keep it alive)");
        Resuming += (_, _) => SpikeLog.Write("app: resuming");
        UnhandledException += (_, args) => SpikeLog.Write($"app: UNHANDLED {args.Exception.GetType().Name}: {args.Message}");
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        if (Window.Current.Content is null)
        {
            SpikeSession.DescribeRuntime();
            ShowPage();
        }

        Window.Current.Activate();
    }

    private static void ShowPage()
    {
        var frame = new Frame();
        frame.Navigate(typeof(MainPage));
        Window.Current.Content = frame;
    }

    private void OnEnteredBackground(object sender, EnteredBackgroundEventArgs args)
    {
        Session.EnteredBackground();
        if (DropUiInBackground)
        {
            Window.Current.Content = null;
            GC.Collect();
            GC.WaitForPendingFinalizers();
            SpikeLog.Write("app: page dropped");
        }
    }

    private void OnLeavingBackground(object sender, LeavingBackgroundEventArgs args)
    {
        Session.LeavingBackground();
        if (Window.Current.Content is null)
        {
            ShowPage();
            SpikeLog.Write("app: page rebuilt");
        }
    }
}
