options {
    keys: {
        area: shared
    }
}

contract Pagination: { # Represents a pagination object
    page: int(min=0) = 0 # The page number
    pageSize: int(min=1, max=100) = 25 # The page size
    sort: enum(asc, desc) = desc # The sort order
    total: readonly int(min=0) # The total number of items
}

contract PaginationWithActive: Pagination & {
    active?: boolean # Optionally filter by whether the items are active
}