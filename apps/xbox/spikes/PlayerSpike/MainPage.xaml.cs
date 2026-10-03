using MaroonedSoftware.Deadair.Sdk.Models;
using Windows.Storage;
using Windows.UI.Core;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;

namespace PlayerSpike;

/// <summary>Buttons and the log. Holds nothing that must outlive it.</summary>
public sealed partial class MainPage : Page
{
    private const string OriginSetting = "origin";

    public MainPage()
    {
        InitializeComponent();
        Origin.Text = ApplicationData.Current.LocalSettings.Values[OriginSetting] as string ?? string.Empty;
        DropUi.IsChecked = App.DropUiInBackground;
        Log.Text = string.Join(Environment.NewLine, SpikeLog.Snapshot());
    }

    protected override void OnNavigatedTo(NavigationEventArgs e) => SpikeLog.Written += OnWritten;

    protected override void OnNavigatedFrom(NavigationEventArgs e) => SpikeLog.Written -= OnWritten;

    private void OnWritten(string line) =>
        _ = Dispatcher.RunAsync(CoreDispatcherPriority.Low, () =>
        {
            Log.Text += Environment.NewLine + line;
            Scroller.ChangeView(null, Scroller.ScrollableHeight, null, disableAnimation: true);
        });

    private async void OnRead(object sender, RoutedEventArgs e)
    {
        ApplicationData.Current.LocalSettings.Values[OriginSetting] = Origin.Text;
        await App.Session.ReadStationAsync(Origin.Text);
    }

    private async void OnPlayMp3(object sender, RoutedEventArgs e) => await App.Session.PlayAsync(NowPlayingMountFormat.Mp3);

    private async void OnPlayHls(object sender, RoutedEventArgs e) => await App.Session.PlayAsync(NowPlayingMountFormat.Hls);

    private void OnStop(object sender, RoutedEventArgs e) => App.Session.Stop();

    private void OnDropUiChanged(object sender, RoutedEventArgs e) => App.DropUiInBackground = DropUi.IsChecked == true;
}
