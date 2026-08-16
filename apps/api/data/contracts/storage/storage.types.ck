options {
    keys: {
        area: storage
    }
}

# Which store, as a stable id the console can key off rather than a name it renders.
contract StorageStoreId: enum(tracks, art, segments, voices)

# One content store: what is on disk, and what the database says should be.
#
# The two halves are deliberately separate numbers rather than one reconciled figure. They disagree
# in two directions and each direction means something different — a file nothing claims is what a
# crash between writing bytes and writing a row leaves behind, and a row whose file is gone is what
# an operator emptying a directory leaves. Reporting one number would hide both.
contract StorageStore: {
    id: readonly StorageStoreId
    label: readonly string(min=1, max=100) # What to call it on a page
    path: readonly string(min=1, max=1000) # Where it is, so `du` and this can be compared
    files: readonly int(min=0) # Files actually there
    bytes: readonly int(min=0) # What they weigh
    rows?: readonly int(min=0) # Rows pointing at a file. Absent when no table backs this store
    accountedBytes?: readonly int(min=0) # What those rows say those files weigh. Absent where the table does not record a size
    capBytes?: readonly int(min=0) # The limit an operator set, where the store has one. Absent means no limit
    orphanFiles: readonly int(min=0) # Files no row claims. Reported and never cleaned up automatically
    orphanBytes: readonly int(min=0)
    rowsWithNoFile: readonly int(min=0) # Claims whose file is not there. The station re-fetches or re-renders these
}

# Every store, plus the number an operator actually wants first.
#
# `readAt` is not decoration: the figures come from walking directories, which is real I/O on a
# station holding tens of thousands of files, so the answer is cached for a short while and this is
# what stops a page mistaking it for live.
contract StorageReport: {
    readAt: readonly datetime
    totalFiles: readonly int(min=0)
    totalBytes: readonly int(min=0)
    stores: array(StorageStore)
}
