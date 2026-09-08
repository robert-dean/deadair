using Avalonia;
using Avalonia.Controls;
using MaroonedSoftware.Deadair.Desktop.Services;

namespace MaroonedSoftware.Deadair.Desktop.Controls;

/// <summary>
/// A cover in a list.
/// </summary>
/// <remarks>
/// The loading is a control's own rather than a view model's because a row model is a record the
/// station answered with, and giving every one of them a bitmap and a fetch would put a hundred
/// pending requests in a page's view model. Here the request belongs to the thing on screen, and
/// <see cref="ArtworkLoader"/> is what stops fifty of them going out at once.
/// </remarks>
public partial class Artwork : UserControl
{
    public static readonly StyledProperty<Uri?> SourceProperty =
        AvaloniaProperty.Register<Artwork, Uri?>(nameof(Source));

    public static readonly StyledProperty<string> InitialProperty =
        AvaloniaProperty.Register<Artwork, string>(nameof(Initial), "?");

    public static readonly StyledProperty<double> SizeProperty =
        AvaloniaProperty.Register<Artwork, double>(nameof(Size), 36);

    public Artwork() => InitializeComponent();

    /// <summary>Where the cover is, already resolved against the station.</summary>
    public Uri? Source
    {
        get => GetValue(SourceProperty);
        set => SetValue(SourceProperty, value);
    }

    /// <summary>What to draw when there is no cover, or none yet.</summary>
    public string Initial
    {
        get => GetValue(InitialProperty);
        set => SetValue(InitialProperty, value);
    }

    public double Size
    {
        get => GetValue(SizeProperty);
        set => SetValue(SizeProperty, value);
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);

        if (change.Property == SizeProperty)
        {
            Frame.Width = Frame.Height = Size;
            Letter.FontSize = Math.Round(Size * 0.42);
        }
        else if (change.Property == InitialProperty)
        {
            Letter.Text = Initial;
        }
        else if (change.Property == SourceProperty)
        {
            Cover.Source = null;
            _ = LoadAsync(Source);
        }
    }

    private async Task LoadAsync(Uri? url)
    {
        if (url is null || ArtworkLoader.Shared is not { } loader)
        {
            return;
        }

        var bitmap = await loader.GetAsync(url).ConfigureAwait(true);

        // A list recycles its rows, so by the time this answers the control may be showing a
        // different record. Without this check a fast scroll leaves covers on the wrong rows.
        if (ReferenceEquals(url, Source) || url == Source)
        {
            Cover.Source = bitmap;
        }
    }
}
