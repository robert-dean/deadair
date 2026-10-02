import SwiftUI

/// One question with a few answers, drawn as Android's segmented button row: a pill outline across
/// the width, a line between each answer, and the chosen one filled. Icons only; each segment carries
/// its own name for VoiceOver, so a page of these is a page of distinguishable controls.
///
/// `selected` may be nothing: an unrated script shows no segment pressed, which is not the same as
/// the middle one.
struct SegmentedChoice<Value: Hashable>: View {
    struct Segment {
        let value: Value
        let symbol: String
        let name: String
    }

    let segments: [Segment]
    let selected: Value?
    var height: CGFloat = 40
    var iconSize: CGFloat = 18
    let onPick: (Value) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(segments.enumerated()), id: \.offset) { index, segment in
                if index > 0 { Rectangle().fill(Color(uiColor: .separator)).frame(width: 1) }
                let chosen = segment.value == selected
                Button {
                    onPick(segment.value)
                } label: {
                    Image(systemName: chosen ? "\(segment.symbol).fill" : segment.symbol)
                        .font(.system(size: iconSize))
                        .foregroundStyle(chosen ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(chosen ? AnyShapeStyle(.tint.opacity(0.18)) : AnyShapeStyle(.clear))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(segment.name))
                .accessibilityAddTraits(chosen ? .isSelected : [])
            }
        }
        .frame(height: height)
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(Color(uiColor: .separator)))
    }
}

/// Android's `OutlinedButton`: the words in the accent, a hairline pill round them, nothing filled.
struct OutlinedButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.medium))
            .foregroundStyle(isEnabled ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
            .padding(.horizontal, 20)
            .frame(minHeight: 44)
            .background(Capsule().fill(.tint.opacity(configuration.isPressed ? 0.12 : 0)))
            .overlay(Capsule().strokeBorder(Color(uiColor: .separator)))
            .contentShape(Capsule())
    }
}

extension ButtonStyle where Self == OutlinedButtonStyle {
    static var outlined: OutlinedButtonStyle { OutlinedButtonStyle() }
}
