using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// What the station thinks of one act, release or record, and the three answers it can be given.
/// </summary>
/// <remarks>
/// <para>
/// One question with three answers, not two switches. Withdrawing an opinion is choosing the middle,
/// which is why it is a button of its own rather than a second press on the lit side: somebody should
/// be able to see that the middle is where they started.
/// </para>
/// <para>
/// The middle is never drawn lit. Every row has an implicit place in the rotation whether or not
/// anybody said so, and a list of hundreds of unrated records each showing "no opinion" pressed
/// would read as hundreds of decisions somebody made.
/// </para>
/// <para>
/// The answer changes when the STATION has it, not when the button is pressed, and stays as it was
/// while the write is in flight: the answer on screen is the one the station holds.
/// </para>
/// </remarks>
public sealed partial class RatingViewModel(
    Rating rating,
    string label,
    Func<Rating, CancellationToken, Task<Rating?>> write) : ObservableObject
{
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsLiked), nameof(IsDisliked))]
    private Rating _value = rating;

    [ObservableProperty]
    private bool _busy;

    public bool IsLiked => Value == Rating.Liked;

    public bool IsDisliked => Value == Rating.Disliked;

    public string LikeHint { get; } = $"Play {label} more often";

    public string NeutralHint { get; } = $"No opinion about {label}";

    public string DislikeHint { get; } = $"Never play {label}";

    /// <summary>A rating that changes nothing and says nothing, for a row that is only being looked at.</summary>
    public static RatingViewModel Fixed(Rating rating, string label) =>
        new(rating, label, (_, _) => Task.FromResult<Rating?>(null));

    /// <param name="choice">`liked`, `neutral` or `disliked`, as the buttons send it.</param>
    [RelayCommand]
    private async Task SetAsync(string choice, CancellationToken cancellationToken)
    {
        if (!Enum.TryParse<Rating>(choice, ignoreCase: true, out var chosen) || chosen == Value || Busy)
        {
            return;
        }

        Busy = true;
        try
        {
            if (await write(chosen, cancellationToken).ConfigureAwait(true) is { } held)
            {
                Value = held;
            }
        }
        finally
        {
            Busy = false;
        }
    }
}
