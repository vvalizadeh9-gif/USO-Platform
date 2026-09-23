# KPI & Performance — Discovery report and plan

Step 1 and Step 2 of the brief. No code has been written yet.

---

## 1. Discovery — where each thing lives today

| Needed | Where it is today | How CPM fills it |
|---|---|---|
| **Work item** | Table `work_items`. One row per (site, site type) — `UniqueConstraint(site_id, site_type)`. | Every CPM row is grouped onto a site (`کد سایت ایرانسل`, col M) + site type (`نوع سایت`, col T). |
| **Village** | Table `villages`. Column `work_item_id` — a village row belongs to exactly **one** work item; a work item can have many. | One row per CPM line, but only lines classified exactly `هدف` (col AD). Everything else (`اقماری`, `هدف (Verbally)`, …) is counted and dropped at import. |
| **Province** | Table `provinces` (Persian names). A **site** carries it: `sites.province_id`. A village gets its province through `village → work_item → site → province`. | CPM col D (`استان`), resolved to one of the 31 canonical Iranian provinces. Anything that does not match one of the 31 is stored as **NULL** — see Question 1. |
| **On-air status** | `work_items.last_stage`. On air = `راه_اندازی_موقت` or `راه_اندازی_دائم`. | CPM col X (`آخرین مرحله انجام شده`), refreshed on every monthly import. |
| **DT status ("DT done")** | `work_items.dt_status`, value `Done`. | CPM col AW. Seeded once from the first import, then owned by the app (an approved drive test writes `Done`). |
| **DT approved in UEP** | Table `drive_tests`, `status = 'Approved'`, `is_active = true`. | Not from CPM — created inside UEP by the drive-test workflow. |
| **ICT acceptance (per village)** | `villages.ict_status` — `Approved` / `Rejected` / `Returned` / `Pending` / `NotFiled`. It is a cache of the truth held in `acceptances` (per technology) + `acceptance_submissions` (the rounds), refreshed in the same transaction as every change. | Originally seeded from CPM cols BC–BE; today the app is the system of record. |
| **CRA acceptance (per village)** | `villages.cra_status`, exactly the same shape. | Same. |
| **Contractor (DT SC)** | `work_items.dt_sc_contractor_id` → `contractors.name` (`type = 'drive_test'`). | CPM col AV (`DT SC`). |
| **Last CPM import time** | `cpm_import_batches.created_at`. Today only Admin can read it (`GET /admin/cpm/import-history`). | Written by the import itself. |

### Things that do **not** exist yet

1. **CRA region** — nothing in the database holds Azar / Central / North / … . The `regions` table is a different thing: it stores CPM col AC (`منطقه`), an operational region per site. New master data is needed.
2. **English province names** — provinces are stored in Persian only.
3. **Effective-dated ownership** — there is no history of who owned a province when.
4. **A link from a user account to a regional-manager or coordinator *name*** — see Question 3.

### What already exists and overlaps with Section 3 of the brief

`provinces` already has `coordinator_user_id` and `regional_manager_user_id`, set by **Admin** on the Admin → Province Assignments screen, and read by existing filters on other reports. It has no history and no CRA region, and it points at user accounts rather than at names. See Question 2.

---

## 2. Questions — please answer before I build

1. **Sites with an unrecognised province.** If a CPM `استان` cell does not match one of the 31 provinces, the site's province is left NULL. Those work items and villages belong to no province, so they would fall outside every lens and the acceptance check "sum of all Regional Manager scopes = country totals" would fail by that amount. I propose: the KPI page counts them in the **country total** and shows them in the heatmap as one extra grey row, "Unknown province". Do you agree? I will also report how many such rows exist in the live data before we go further.
2. **Two owners of the same fact.** Admin already assigns coordinator and regional manager per province. The brief says the new mapping is **PM-only** and Admin has **no access**. I propose: build `province_mapping` as a new, separate table used **only** by the KPI page, and leave the existing Admin screen and the reports that read it completely untouched. That means the same fact can be set in two places and can disagree. The alternative is to move the existing screen to PM, which changes an existing feature and needs your approval. Which do you want?
3. **Linking a user account to a person's name.** Simplest option: add one nullable text column to `users`, `kpi_person_name`. For a Regional Manager account it is matched against `province_mapping.regional_manager`; for a PSO Coordinator account against `province_mapping.pso_coordinator`. Contractors need nothing new — `users.contractor_id` already exists and is the DT SC. PM sets this on the mapping screen. Do you agree?
4. **What "rejected" means.** A village that ICT rejected, and which has since been re-submitted and is waiting for an answer, currently reads as `Pending`, not `Rejected` — the queue treats "whose move is it now" as outranking the last verdict. I propose the KPI page uses the same reading, so the KPI page and the acceptance queue can never disagree. Confirm?
5. **"DT done" for the funnel.** Two candidates: CPM's `Done` (col AW), or "drive test approved inside UEP". The brief's metric list says "DT status marked Done in CPM", so I will use CPM `Done`. Confirm — because today they are not identical for old sites.
6. **Two different denominators in the brief.** `ICT remained = Total villages − ICT approved`, but `ICT approved % = ICT approved ÷ DT-done villages`. So the count and the percentage use different bases, and the percentage can read below 100% while nothing remains, or above what the "remained" number suggests. I will implement exactly what the brief says; I just want to be sure it is deliberate.
7. **Contractor scope.** The brief says a contractor sees "work items where DT SC = them". UEP also lets a contractor hold an in-app *assignment* without being the DT SC. For this page I will use **DT SC only**, as written. Confirm?
8. **PDF library.** No PDF library exists in the platform today. I propose `reportlab` — a plain Python package added to `requirements.txt`. **No new Docker service**, no new container. Excel uses `openpyxl`, which is already installed. Confirm?

I have not changed anything outside this feature, and I have not fixed anything I noticed along the way.

---

## 3. Plan (Section 9 delivery order)

### Step 2 — mapping table, migration, seed, endpoints
- New table `province_mapping`: `province_en`, `province_fa`, `cra_region`, `pso_coordinator`, `regional_manager`, `effective_from`, `effective_to` (nullable). One open row per province at a time; a reassignment closes the old row (`effective_to`) and inserts a new one.
- New nullable column `users.kpi_person_name` (Question 3).
- One Alembic migration for both, plus the 31 seed rows, matched to the existing Persian province names. I have checked all 31 English names in the brief against the 31 Persian names already in the code — they map one-to-one with nothing left over.
- Endpoints `GET/POST/PUT /api/v1/kpi/mapping`, PM only.

### Step 3 — KPI endpoints
- `GET /api/v1/kpi/summary?lens=&key=` — work-item funnel, village funnel, country averages, per-province heatmap rows, `low_sample` flag, and the last CPM import time.
- `GET /api/v1/kpi/contractors?key=&mode=ict|cra` — PM and PSO Coordinator only.
- All arithmetic in SQL with `GROUP BY`, over `villages.ict_status` / `cra_status`, `work_items.last_stage` and `work_items.dt_status`. No Python loop over rows.
- Scope is forced server-side from the signed-in user, not read from the query string, for every role except PM. Admin is refused everywhere on this page.
- Tests: one per role for the 403s, plus the country-total reconciliation and the weighted-average check.

### Step 4 — frontend
- New page at `/reports/kpi`, added to the Reports section of the sidebar, hidden from Admin.
- Option B layout exactly as Section 6 describes. The platform's existing design tokens already match your palette (teal `#0EA394`, navy `#16202E`, Space Grotesk + Inter), so this reuses them rather than introducing a second theme.
- Then the PM-only mapping screen.

### Step 5 — exports
- Excel via `openpyxl` (already installed), one sheet per section.
- PDF via `reportlab` (new Python package, no new container), A4 landscape.
- Both built from the same service function the screen calls, so they cannot disagree with it.

### Step 6 — deployment
Copy-paste commands for `/opt/uep`, `git pull` → `docker compose build` → `docker compose up -d`, never `-v`.

---

## 4. What I can and cannot verify here

- **Can**: run the backend test suite (it builds a throwaway SQLite database by running the Alembic migrations, exactly as production does) and the frontend tests.
- **Cannot**: run `alembic current` against your server's PostgreSQL. I have no access to it. When we reach Step 2 I will give you the exact commands to run on the server, and I will ask you to paste back the output of `alembic current` so that "the migration has run" is a fact and not a claim.
