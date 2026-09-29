using Avalonia;
using Avalonia.Controls;

namespace MaroonedSoftware.Deadair.Desktop.Views;

public partial class SearchBar : UserControl
{
    public static readonly StyledProperty<string?> PlaceholderProperty =
        AvaloniaProperty.Register<SearchBar, string?>(nameof(Placeholder));

    public SearchBar()
    {
        InitializeComponent();
        Box.PlaceholderText = Placeholder;
    }

    /// <summary>What the box says while it is empty: "Search records", "Search acts".</summary>
    public string? Placeholder
    {
        get => GetValue(PlaceholderProperty);
        set => SetValue(PlaceholderProperty, value);
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);

        if (change.Property == PlaceholderProperty)
        {
            Box.PlaceholderText = Placeholder;
        }
    }
}
