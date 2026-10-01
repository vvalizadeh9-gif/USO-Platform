# My Work API — design (step 4)

Status: **for review**. Base path `/api/v1/acceptance`. Bearer auth on every
route. This is the contract the backend (step 5) and frontend (step 6) are
built and tested against.

## 0. Conventions

### Roles

| Endpoint | Contractor | Coordinator | PM | RegionalManager / Viewer | Admin |
|---|---|---|---|---|---|
| `GET /my-work`, `GET /villages/{id}`, `GET …/suggestions`, `POST /villages/resolve` | own villages | province grants | all | province grants, `read_only: true` | 403 |
| `POST /scans`, `POST /letters` | ✓ (rounds pending) | ✓ (rounds decided) | ✓ (rounds decided) | 403 | 403 |
| `POST /letters/review` | 403 | ✓ | ✓ | 403 | 403 |

Admin is refused outright: the systems role does no operational work
(ARCHITECTURE.md §6), and the nav already hides My Work from it. Row-level scope
is always `acceptance_workflow.visible_villages` (→ `apply_work_item_scope`).

### Vocabulary on the wire

Role-neutral keys; the frontend owns every label.

| Key | Values |
|---|---|
| `Authority` | `ICT` · `CRA` |
| `SideStatus` | `waiting` · `filled` · `returned` · `rejected` · `approved` (mapped 1:1 from the stored `NotFiled` · `Pending` · `Returned` · `Rejected` · `Approved`) |
| `Tab` | `your_move` · `new_letter` · `returned` · `not_filed` · `filled` · `all` |
| `ClaimResult` | `approved` · `rejected` |
| `RoundResult` | `pending` · `approved` · `rejected` · `returned` · `withdrawn` |
| `Scope` | `remaining` (default) · `universe` |
| `Sort` | `waiting_longest` (default) · `waiting_shortest` · `name` |

Tabs per role, in order (server-sent, so the frontend never hard-codes them):

- contractor: `your_move` (default), `new_letter`, `returned`, `not_filed`, `filled`;
- coordinator / PM / read-only: `filled` (default), `not_filed`, `new_letter`, `returned`, `all`;
- `scope=universe` appends `all` for a contractor, because a fully approved village is in no other tab.

Bucket rule (`services/my_work_status.py`, one table, Python and SQL generated from it):

| Tab | A village is in it when |
|---|---|
| `new_letter` | any side `rejected` |
| `returned` | not the above, and any side `returned` |
| `not_filed` | neither of the above, and any side `waiting` |
| `your_move` | `new_letter` ∪ `returned` ∪ `not_filed` |
| `filled` | any side `filled` (may overlap the three above) |
| `all` | every row in scope |

The tabs are **not a partition**: their counts do not sum to the total.

### Digits and dates

- Every string input that carries digits (`letter_number`, `letter_date`,
  `q`, `codes`) is normalised server-side to Latin digits by one function,
  `core/digits.py::to_latin`. Persian and Arabic-Indic digits are accepted.
  This matters for `letter_number`, because "Confirm all on this letter" matches on it.
- `letter_date` input is Shamsi `YYYY/MM/DD` and is converted by `core/jalali.py`.
  Every date in a response is sent twice: `…_date` (ISO Gregorian) and
  `…_date_shamsi` (`1405/04/11`, Latin digits). The browser does no calendar
  arithmetic and only swaps digits for display.

### Errors

Pydantic shape errors keep FastAPI's default `422`. Rule failures use one body:

```jsonc
// 400 rule failure · 409 state changed since the client loaded it
{ "detail": {
    "code": "letter_invalid",
    "message": "2 of 40 villages could not be filed, so none were",
    "errors": [
      { "field": "scan_id",  "code": "scan_missing" },
      { "village_id": 812, "tech": "4G", "code": "reason_missing" },
      { "village_id": 907, "code": "not_found" }
    ]
} }
```

Error codes: `missing` · `invalid_date` · `scan_missing` · `scan_expired` ·
`reason_missing` · `not_found` · `duplicate_village` · `tech_not_requested` ·
`tech_missing` · `tech_carried` · `dt_not_done` · `not_editable` (409) ·
`not_pending` (409) · `own_submission` · `nothing_to_review` · `invalid_cursor`.

The frontend maps `field` / `village_id` + `tech` codes onto the in-field
"Missing" / "Scan missing" / "Reason missing" states. A village outside the
caller's scope is **always** `not_found`, never 403, so ids can't be probed.

---

## 1. `GET /my-work`

```
GET /acceptance/my-work?scope=remaining&tab=your_move&authority=&q=&sort=waiting_longest&cursor=&limit=100
```

| Param | Notes |
|---|---|
| `scope` | `remaining`: DT done ∧ on air ∧ هدف ∧ ICT or CRA not approved. `universe`: the Acceptance Dashboard's universe (DT done ∧ هدف). |
| `tab` | Defaults to the role's first tab. |
| `authority` | Optional. Narrows rows **and counts** to villages where that side matches the tab. Replaces the Action Center's `awaiting=ICT`, which becomes `tab=filled&authority=ICT`. |
| `q` | Village name, village code, or site code (case-insensitive, digit-normalised). |
| `cursor` | Opaque keyset cursor (sort key + id, bound to scope/tab/q/sort/authority). A mismatched or tampered cursor gives `400 invalid_cursor`. |
| `limit` | 0–500, default 100. **`limit=0` returns counts only**: the sidebar badge reads this, so it can never disagree with the tabs. |

```jsonc
200 {
  "scope": "remaining",
  "tab": "your_move",
  "view": "contractor",            // contractor | staff
  "read_only": false,
  "tabs": [ { "key": "your_move", "count": 14 }, { "key": "new_letter", "count": 3 }, … ],
  "authority_totals": {            // contractor: not approved · staff: filled (to check)
    "kind": "not_approved",
    "ICT": 9, "CRA": 9
  },
  "total": 14,                     // rows in this tab
  "rows": [ MyWorkRow, … ],
  "next_cursor": "eyJr…" | null,
  "long_wait_days": 60
}
```

`MyWorkRow`:

```jsonc
{
  "village_id": 812,
  "village_code": "V-10422",
  "village_name": "سرآسیاب",
  "site_id": 301, "site_code": "KHR-0417",
  "work_item_id": 455,
  "province_name": "خراسان رضوی",
  "contractor_name": "Pars Co.",   // the DT subcontractor; the UI shows it to staff only
  "requested_technologies": ["2G", "4G"],
  "dt_date": "2026-05-02", "dt_date_shamsi": "1405/02/12",
  "days_waiting": 74,              // authority clock, falls back to DT age when never filed
  "long_wait": true,               // days_waiting >= long_wait_days (rule lives on the server)
  "refiling_round": 2,             // "Round N" tag; null unless a side is being re-filed
  "sides": {
    "ICT": { "status": "rejected", "round_no": 1, "next_round_no": 2,
             "editable": true, "reviewable": false },
    "CRA": { "status": "filled",   "round_no": 1, "next_round_no": null,
             "editable": false, "reviewable": false }
  }
}
```

`editable` = the viewer may file this side now (status `waiting` / `returned` /
`rejected`, not read-only). `reviewable` = staff, status `filled`, not the
viewer's own filing.

Counts, totals and rows come from **one** base select. Counts are
`count(*) FILTER (WHERE <tab predicate>)` over it, and rows are the same select
with the tab predicate, ordered and cut.

## 2. `GET /villages/{id}`

The existing route, **extended additively**: the old fields (`village`,
`dt_status`, `submissions`) stay for one release, marked deprecated, then go.

```jsonc
200 {
  "village_id": 812,
  "facts": {                       // the Requested card, six fields, in order
    "site_id": 301, "site_code": "KHR-0417",
    "province_name": "خراسان رضوی",
    "village_code": "V-10422", "village_name": "سرآسیاب",
    "requested_technologies": ["2G", "4G"],
    "dt_date": "2026-05-02", "dt_date_shamsi": "1405/02/12"
  },
  "contractor_name": "Pars Co.",
  "sides": { "ICT": SideDetail, "CRA": SideDetail },
  // deprecated, removed next release:
  "village": { … }, "dt_status": "Done", "submissions": [ … ]
}
```

`SideDetail`:

```jsonc
{
  "status": "rejected", "round_no": 1, "next_round_no": 2,
  "editable": true, "reviewable": false,
  "to_file": ["4G"],               // techs the next round must claim
  "carry_over": [                  // from the last decided round
    { "tech": "2G", "result": "approved", "round_no": 1 },
    { "tech": "4G", "result": "rejected", "round_no": 1 }
  ],
  "last_reason": {                 // bottom note; null when none
    "round_no": 1, "kind": "rejected",          // rejected | returned
    "techs": ["4G"], "reason": "weak signal at the village centre"
  },
  "same_letter": {                 // only when reviewable: "Confirm all N on this letter"
    "letter_number": "1405/ص/1920", "count": 12   // pending, same authority, in viewer's scope
  } | null,
  "history": [ Round, … ]          // newest first, every round; the UI shows two and "Show all N"
}
```

`Round`:

```jsonc
{
  "submission_id": 5531, "round_no": 1,
  "letter_number": "1405/ص/1920",
  "letter_date": "2026-07-02", "letter_date_shamsi": "1405/04/11",
  "result": "rejected",
  "source": "Contractor",
  "submitted_by_name": "…", "submitted_at": "…",
  "reviewed_by_name": "…",  "reviewed_at": "…",
  "return_reason": null,
  "claims": [ { "tech": "2G", "result": "approved", "reason": null },
              { "tech": "4G", "result": "rejected", "reason": "weak signal …" } ],
  "scan": { "evidence_id": 991, "filename": "letter.pdf" } | null   // View scan → GET /evidence/{id}/download (kept)
}
```

## 3. `GET /villages/{id}/suggestions?authority=ICT`

Other villages on the same site, in the viewer's scope and the same `scope`
rule, whose side for `authority` is `editable` for this viewer. These feed the
"+ N from SITE" button.

```jsonc
200 { "site_id": 301, "site_code": "KHR-0417",
      "villages": [ { "village_id": 813, "village_code": "V-10423",
                      "village_name": "…", "status": "waiting" } ] }
```

## 4. `POST /villages/resolve`

```jsonc
{ "codes": ["V-10422", "V-۱۰۴۲۳", "X-1"],   // 1–500; trimmed, digit-normalised, case-folded, de-duplicated
  "scope": "remaining" }
→ 200 { "total": 3,
        "matched":   [ { "code": "V-10422", "village_id": 812 }, … ],
        "unmatched": [ "X-1" ] }
```

Matched only against the caller's scoped select. A code belonging to another
contractor is `unmatched`, indistinguishable from a code that doesn't exist.
`unmatched` drives "K not in your list".

## 5. `POST /scans`

`multipart/form-data`, field `file`. Same type and size checks as today's
evidence upload (`evidence_store`, magic bytes; limits from `GET /limits`, kept).

```jsonc
201 { "scan_id": "<signed token>", "filename": "letter.pdf",
      "content_type": "application/pdf", "size_bytes": 482113,
      "expires_at": "2026-10-02T09:14:00Z" }
```

`scan_id` is HMAC-signed (sha256, stored path, filename, type, size,
uploader, expiry 24 h). Only its uploader can use it; otherwise the result is
`scan_missing` / `scan_expired`. There is no staging table.

## 6. `POST /letters`

```jsonc
{
  "authority": "ICT",
  "letter_number": "۱۴۰۵/ص/۱۹۲۰",          // stored as 1405/ص/1920
  "letter_date": "1405/04/11",              // Shamsi, required
  "scan_id": "<token>",                     // required
  "items": [                                // 1–500, unique village_id
    { "village_id": 812,
      "claims": [ { "tech": "4G", "result": "rejected", "reason": "weak signal …" } ] },
    { "village_id": 813,
      "claims": [ { "tech": "2G", "result": "approved" },
                  { "tech": "4G", "result": "approved" } ] }
  ]
}
```

Per village, `claims` must cover **exactly** that side's `to_file`. That is
all requested technologies on round 1, and only the previously refused ones
on a re-file (`tech_carried` if an already-approved tech is claimed). Each
`rejected` claim needs a `reason`.

Behaviour, in one transaction:

1. Validate the letter fields; collect every error.
2. Lock the villages `FOR UPDATE`, in id order (serialises round numbering, avoids deadlock).
3. Per item: `flow.submit()` for a contractor (round **pending**), or
   `flow.record_decided()` for a coordinator/PM (round **validated** at once,
   `reviewed_by` = actor, `reviewed_at` = now, projected to `acceptances`).
4. Any failure → roll back everything and return `400 letter_invalid` listing all of them.
5. Attach one evidence row per submission (content-addressed, one blob).
6. One audit entry. One reviewer notification for a contractor filing; none for a staff save.

```jsonc
201 { "authority": "ICT", "letter_number": "1405/ص/1920",
      "decided": false,                     // true for a staff save
      "count": 2,
      "results": [ { "village_id": 812, "submission_id": 5602, "round_no": 2, "status": "filled" },
                   { "village_id": 813, "submission_id": 5603, "round_no": 1, "status": "filled" } ] }
```

Sending ICT never touches CRA: one authority per request, and nothing in the
path reads or writes the other side.

## 7. `POST /letters/review`

Coordinator / PM only.

```jsonc
{ "authority": "ICT",
  "letter_number": "1405/ص/1920",   // exactly one of letter_number | submission_ids
  "submission_ids": [5602],         // 1–500
  "decision": "confirm",            // confirm | return
  "reason": "the scan is illegible" // required for return
}
```

- `letter_number`: every **pending** submission for that authority and letter in the caller's scope. This is "Confirm all N on this letter".
- `submission_ids`: exactly those. Each must be pending (`409 not_pending` if someone decided it meanwhile), in scope (`not_found`) and of that authority.
- `confirm` = `flow.review(decision=Validated)`: approved if every claim was approved, otherwise rejected with the contractor's reasons.
- `return` = `flow.review(decision=Returned, comment=reason)`.
- `own_submission`: the existing guard still applies; nobody confirms their own filing.
- All-or-nothing, one transaction, one audit entry.

```jsonc
200 { "decision": "confirm", "count": 12,
      "results": [ { "submission_id": 5602, "village_id": 812, "status": "rejected" }, … ] }
```

---

## 8. Retired after one release

Marked `deprecated=True` in OpenAPI and answering with a `Deprecation: true`
header from this release on. Only the old My Work pages call them, and those
pages are replaced in this release.

`GET /villages` · `GET /villages/bucket-counts` · `POST /villages/{id}/submissions` ·
`POST /submissions/bulk` · `PUT /submissions/{id}` · `POST /submissions/{id}/withdraw` ·
`POST /submissions/{id}/review` · `POST /submissions/{id}/evidence` · `DELETE /evidence/{id}` ·
the deprecated fields of `GET /villages/{id}`.

**Kept:** `GET /evidence/{id}/download` (View scan) and `GET /limits` (attach-button limits).

## 9. Known limits, accepted

- **No idempotency key.** A contractor double-send is caught by the
  one-pending-per-authority index (`not_editable`). A staff double-send after a
  rejection would file round N+1. The deferred-commit Undo sends once, and the
  button disables while sending. A durable idempotency key would need a table,
  and is proposed only if this shows up in practice.
- **Abandoned scans leave one blob.** Content-addressed and small; noted for a future GC job.
