// Announced by the API client after every successful write (assign, review,
// approve, import ...). The sidebar badges listen for it instead of re-reading
// their counts on every page change: counts only move when something is
// written, so refreshing on navigation paid for a heavy request on every click
// and still missed an action taken without leaving the page.
export const DATA_CHANGED_EVENT = 'uep:data-changed'
