# Roles Performance API

All routes are read-only, under `/api/v1/kpi`, and each one runs
`require_kpi_access` and `resolve_scope` (`services/kpi.py`). Response
models are in `app/schemas/roles_performance.py`. ARCHITECTURE.md section 5b
has the definitions behind every number.

## Contract rules

* A Shamsi month is `{year, month, label_fa}`. `label_fa` is the Persian name
  with Persian digits (`مهر ۱۴۰۵`).
* Every comparison carries `now`, `ref`, `delta`, `lower_is_better`,
  `recorded` and `ref_recorded`.
* A value that was not recorded (approvals, full config and the problematic
  flows before Mehr 1405) is `null` with `recorded: false`. It is never `0`.
* Asking for a scope the caller may not see is a **403**, never an empty
  result.

## Who may call what

| Route | PM | Viewer | RM / Coordinator / Contractor | Admin |
|---|---|---|---|---|
| `GET /month`, `/month.xlsx` | yes | yes | 403 | 403 |
| `GET /area`, `/area.xlsx` | any scope | any scope | own scope only | 403 |
| `GET /performance`, `/performance.xlsx` | any scope | any scope | own scope only | 403 |
| `GET /compare`, `/compare.xlsx` | yes | yes | 403 | 403 |
| `GET /lenses` | every option | every option | own only | 403 |
| mapping and link writes | yes | **403** | 403 | 403 |

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

## `GET /kpi/month?month=YYYY-MM&by=all|coordinator|contractor|rm`

`month` defaults to the current Shamsi month. A month that has not started is
a 422.

```json
{
  "month": {"year": 1405, "month": 7, "label_fa": "مهر ۱۴۰۵"},
  "ref_month": {"year": 1405, "month": 6, "label_fa": "شهریور ۱۴۰۵"},
  "running": true, "day": 10, "days_in_month": 30, "ref_day": 10,
  "by": "rm",
  "sections": [
    {"key": "delivery", "title": "Project delivery",
     "block": {"value": 5, "unit": "sites"},
     "rows": [
       {"key": "dt_done", "label": "DT done", "unit": "sites",
        "now": 2, "ref": 1, "delta": 1, "lower_is_better": false,
        "recorded": true, "ref_recorded": true,
        "villages": {"now": 14, "ref": 10, "delta": 4, "...": "..."},
        "owners": [
          {"name": "Karimi", "now": 1, "ref": 0, "delta": 1, "...": "..."},
          {"name": "Unattributed", "now": 1, "ref": 0, "delta": 1, "...": "..."}
        ]}
     ]}
  ],
  "recorded_from": {"year": 1405, "month": 7, "label_fa": "مهر ۱۴۰۵"},
  "undated_on_air": 1,
  "last_cpm_import": "2026-10-01T08:00:00Z"
}
```

* The running month is cut at today's day of the month. The previous month
  is cut at the same day, capped at its length. A closed month is compared
  whole against whole.
* `owners` is `null` when `by=all`. Otherwise it lists the owners with
  anything in either window, highest first, credited by who owned the
  province on the event date. "Unattributed" comes last and appears only when
  it is non-zero. The entries always sum to the row's `now`.
* `villages` is set on the two rows counted in both units (on air, DT done).
* `undated_on_air` is the number of on-air sites that carry no date at all.
  They count today but in no month.

## `GET /kpi/area?lens=&key=&breakdown=province|region|contractor`

Today's standing. `breakdown` defaults by role: PM and Viewer get `region`,
coordinators and regional managers get `contractor`, and a contractor gets
`province`. `breakdown=contractor` is a **403** for a contractor.

* `cards`: six. PM and Viewer get on air, DT done, ICT, CRA, fully accepted
  and problematic. Everyone else gets villages in scope, on air, DT done,
  ICT, CRA and fully accepted (with `remaining`). Each card carries `count`,
  `rate`, `base`, `base_label` and `national_rate`.
* `rows`: one per breakdown key. Each carries `villages`, `dt_done`,
  `on_air_only` and `not_on_air` (which together make the stacked bar),
  `ict` and `cra` as `{rate, count, national}`, `remaining` and `low_sample`.
  Unowned rows (Unknown province, Unmapped province, Unassigned) come last.
* `open_work`: not on air, waiting for DT, and DT done with ICT or with CRA
  not approved.
* `read_only` is true for Viewer.

## `GET /kpi/performance?lens=&key=&from=YYYY-MM&to=YYYY-MM`

`from`..`to` defaults to the last six months and is capped at 24.

* `results` is `null` for the whole country, whose results are the national
  figures. Otherwise it holds:
  * `tiles` (DT done, on air, ICT, CRA): rate, count, base, `movement` (this
    month so far), and the national rate and role average, each with its gap
    in points.
  * `series`: one entry per month, with `dt_done`, `ict_approved` and
    `cra_approved` as `{count, recorded}`, plus `ict_role_average` and
    `running`.
* `activity` is `null` unless the lens acts in UEP (contractor, coordinator,
  country = PM). Otherwise it holds:
  * `trend`: five months of `filed` and `validated`.
  * `response_times`: the three medians (`validation`, `first_filing`,
    `refiling`), each with `pairs`, `low_sample` (fewer than 10 pairs) and
    `role_median_days`.

The role average is a plain mean of the compared owners for the kinds that
partition the country (RM, coordinator, region, province), and weighted for
contractors.

## `GET /kpi/compare?kind=&measure=&period=`

`kind` is one of `contractor | coordinator | rm | province | region`.
`measure` is one of `dt | onair | ict | cra | speed`. `period` is `all` or
`month:YYYY-MM`.

* `measure=speed` exists for contractors (DT done to first filing) and
  coordinators (filing to validation). For any other kind it falls back to
  `ict`, and the response says `"measure": "ict"`.
* `rows`: `name`, `label`, `rate` (or median days), `count`, `base`, `delta`
  against national, `low_sample`, `rank` (`null` for "Not compared"), and a
  six-month `series`. Compared rows come first, best first (fastest first for
  speed).
* `headline`: `national`, `average`, `highest` and `lowest`.
* `kinds`: each kind with its count and whether it has speed.

With `period=all` a rate is today's standing. With one month it is that
month's events, credited at the time, as a share of the owner's base today.

## `GET /kpi/lenses`

For PM and Viewer the response has three parts:

* `options`: every person, contractor, region and province;
* `past`: people and regions who owned provinces once and own none now;
* `labels.province`: the English label for each Persian province name.

Anyone else gets their own lens and key only.

## Exports

`/kpi/month.xlsx`, `/area.xlsx`, `/performance.xlsx` and `/compare.xlsx`
take the same parameters as their screen. They are built from the same
payload, and the first sheet has one row per row on screen
(`X-Row-Count`). Files above 20,000 rows are streamed.

## Deprecated

`GET /kpi/summary`, `/kpi/contractors` and `/kpi/export.{xlsx,pdf}` served
the old KPI & Performance page. They are marked `deprecated` in OpenAPI, keep
working for one release, and are then removed.
