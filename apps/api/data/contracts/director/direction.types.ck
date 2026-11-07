options {
    keys: {
        area: director
    }
}

# A line the operator gives the presenters for a while. Talk breaks, banter between co-hosts and the
# changeover into a show hear it as a lean on what they talk about, never as a fact to state or a
# line to read out. Bulletins, the date, jingles and calls never hear it
contract TalkDirection: {
    words: string(min=1, max=280) # What the presenters are told, as the operator wrote it
    endsAt: datetime # When the presenters stop hearing it
}

# The direction in force, or none
contract TalkDirectionReading: {
    direction?: TalkDirection # Absent when nothing is directing the presenters, including once a direction has run out
}

# Direct the presenters for a number of hours
contract TalkDirectionInput: {
    words: string(min=1, max=280) # A lean for the presenters, such as "it's Sam's birthday tonight" or "we're snowed in, keep it cosy"
    hours: int(min=1, max=24) # How long it lasts, from now
}
