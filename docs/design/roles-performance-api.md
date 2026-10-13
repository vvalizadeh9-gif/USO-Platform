# Roles Performance API

All routes are read-only, under `/api/v1/kpi`, and each one runs
`require_kpi_access` and `resolve_scope` (`services/kpi.py`). Response
models are in `app/schemas/roles_performance.py`. ARCHITECTURE.md section 5b
has the definitions behind every number.

## Contract rules

* A Shamsi month is `{year, month, label_fa}`. `label_fa` is the Persian name
  with Persian digits (`مهر ۱۴۰۵`).
* Every Month count carries `now`, `ref`, `delta`, `lower_is_better`,
  `recorded` and `ref_recorded`. The screen reads `now` only; the comparison
  is kept for the export.
* A value that was not recorded (approvals, full config and the problematic
  flows before Mehr 1405) is `null` with `recorded: false`. It is never `0`.
* Asking for a scope the caller may not see is a **403**, never an empty
  result.

## Who may call what

| Route | PM | Viewer | RM / Coordinator / Contractor | Admin |
|---|---|---|---|---|
| `GET /month`, `/month.xlsx` | yes | yes | 403 | 403 |
| `GET /area`, `/area.xlsx` | any scope | any scope | own scope only | 403 |
| `GET /lenses` | every option | every option | own only | 403 |
| mapping and link writes | yes | **403** | 403 | 403 |

`/performance`, `/performance.xlsx`, `/compare` and `/compare.xlsx` were
removed in UEP-09 and answer 404.

## Scope parameters

`lens` and `key` choose whose figures are shown. PM and Viewer may send any
of them, and with neither they get the whole country. Everyone else may omit
both (they get their own scope) or send their own.

| `lens` | `key` |
|---|---|
| `country` | (none) |
| `rm`, `coordinator` | the person's name as the mapping spells it |
| `region` | the CRA region |
| `contractor` | the contractor's name |
| `province` | the Persian province name (the English one is accepted too) |

## `GET /kpi/month?month=YYYY-MM&by=all|owners|coordinator|contractor|rm`

`month` defaults to `default_month`: the **last closed month**, or the running
month while the last closed month is before `recorded_from` (until 1 Aban
1405). The payload's `month` says which month was used. A month that has not
started is a 422.

```json
{
  "month": {"year": 1405, "month": 7, "label_fa": "مهر ۱۴۰۵"},
  "ref_month": {"year": 1405, "month": 6, "label_fa": "شهریور ۱۴۰۵"},
  "running": true, "day": 10, "days_in_month": 30, "ref_day": 10,
  "by": "owners",
  "sections": [
    {"key": "delivery", "title": "Project delivery",
     "block": {"value": 5, "unit": "sites"},
     "rows": [
       {"key": "dt_done", "label": "DT done", "unit": "sites",
        "now": 2, "ref": 1, "delta": 1, "lower_is_better": false,
        "recorded": true, "ref_recorded": true,
        "villages": {"now": 14, "ref": 10, "delta": 4, "...": "..."},
        "owners": null,
        "owners_by": {
          "contractor": [{"name": "RP-Alpha", "now": 1, "...": "..."},
                         {"name": "RP-Beta", "now": 0, "...": "..."},
                         {"name": "Unattributed", "now": 1, "...": "..."}],
          "rm": ["..."],
          "coordinator": ["..."]
        }}
     ]}
  ],
  "recorded_from": {"year": 1405, "month": 7, "label_fa": "مهر ۱۴۰۵"},
  "current_month": {"year": 1405, "month": 7, "label_fa": "مهر ۱۴۰۵"},
  "first_year": 1404,
  "undated_on_air": 1,
  "last_cpm_import": "2026-10-01T08:00:00Z"
}
```

* `by=owners` (the screen) fills `owners_by` on every recorded row: three
  lists in one call, loading the ownership once. Each list is sorted high to
  low and **sums to the row's `now`**. Credit goes to whoever owned the
  province on the event date. "Unattributed" comes last and appears only when
  non-zero. Owners who could have been credited but had nothing are listed at
  0 (contractors with a live site; regional managers and coordinators who held
  a province at any point in the month), so the screen can say who had none.
* `by=coordinator|contractor|rm` (the export) fills `owners` with one such
  list, without the zero entries. `by=all` fills neither.
* `current_month` and `first_year` bound the month picker.
* The previous-month figures (`ref`, `delta`) cut the running month at today's
  day of the month and the previous month at the same day; a closed month is
  compared whole against whole. Only the export shows them.
* `villages` is set on the two rows counted in both units (on air, DT done).
* `undated_on_air` is the number of on-air sites that carry no date at all.
  They count today but in no month.

## `GET /kpi/area?lens=&key=&breakdown=province|region|contractor|coordinator|rm`

Today's standing of one scope, and every member of one breakdown with the
same five measures, so the screen can rank them against national.

```json
{
  "scope": {"lens": "country", "key": "Whole country", "...": "..."},
  "as_of": "2026-10-01T08:00:00Z",
  "read_only": false,
  "totals": {"villages": 38,
             "onair": {"count": 38, "rate": 100.0},
             "dt": {"count": 34, "rate": 89.5},
             "full": {"count": 1, "rate": 2.6},
             "ict": {"count": 8, "rate": 23.5},
             "cra": {"count": 1, "rate": 2.9}},
  "national": {"onair": 100.0, "dt": 89.5, "full": 2.6, "ict": 23.5, "cra": 2.9},
  "breakdown": "province",
  "breakdowns": ["province", "region", "contractor", "coordinator", "rm"],
  "rows": [
    {"name": "Tehran", "gaps_key": "تهران", "villages": 12,
     "measures": {"onair": {"count": 12, "rate": 100.0}, "...": "..."},
     "low_sample": false}
  ],
  "low_sample_threshold": 10
}
```

* Denominators: `onair`, `dt` and `full` are a share of villages; `ict` and
  `cra` are a share of DT-done villages.
* `breakdowns` is what the screen offers. PM and Viewer: all five, minus the
  scope's own kind. Regional managers and coordinators: `province`, `region`,
  `contractor`. Contractors: `province`, `region`. `breakdown` defaults to the
  first offered. Asking for one the role may not have is a **403**
  (`coordinator`/`rm` for anyone but PM and Viewer; `contractor` for a
  contractor).
* `rows` come in a stable order, unowned rows last (Unknown province,
  Unmapped province, Unassigned); the screen sorts them by gap to national.
  `low_sample` is fewer than 10 DT-done villages. `gaps_key` opens the row in
  Lifecycle Gaps (`null` for an unowned row).
* Every figure is a fold of the same (province, contractor) cells, so a scoped
  area equals the sum of its provinces and the rows add up to `totals`.

## `GET /kpi/lenses`

For PM and Viewer the response has three parts:

* `options`: every person, contractor, region and province;
* `past`: people and regions who owned provinces once and own none now;
* `labels.province`: the English label for each Persian province name.

Anyone else gets their own lens and key only.

## Exports

`/kpi/month.xlsx` and `/kpi/area.xlsx` take the same parameters as their
screen. They are built from the same payload, and the first sheet has one
row per row (`X-Row-Count`). The Month workbook keeps the previous month and
the change. The Area workbook lists each breakdown member's villages and the
five measures (count and rate), and a Scope sheet with the totals and
national. Files above 20,000 rows are streamed.

## Deprecated

`GET /kpi/summary`, `/kpi/contractors` and `/kpi/export.{xlsx,pdf}` served
the old KPI & Performance page. They are marked `deprecated` in OpenAPI, keep
working for one release, and are then removed.
