# Research: Training plans by experience level

Sourced findings behind Daily Rep's leveled plans (`src/data/plans.ts`). Conducted via multi-source web research with an adversarial verification pass.

**Governing principle:** total weekly volume taken close enough to failure is the primary driver of hypertrophy; frequency, split, and periodization mostly *distribute* that volume. Training age changes how much volume you need, how heavy you must lift, and how fast you can add load.

## Level → structure (what the plans encode)

| | Beginner | Intermediate | Advanced |
|---|---|---|---|
| Days/week | 2–3 | 3–4 | 4–6 |
| Split | Full body | Upper / Lower | Push / Pull / Legs |
| Sets/muscle/week | ~8–12 | ~12–16 | ~16–20+ |
| Each muscle trained | 3× | 2× | 2× |
| Progression | Linear, per session | Weekly load + double progression | Block volume ramp + DUP |
| Deload | On stall only | Every 6–8 wk | Every 4–6 wk |

Implemented plans: the catalogue ships ~37 real named programs — e.g. **StrongLifts 5x5**, **Starting Strength**, **Greyskull LP**, **GZCLP**, **Madcow 5x5**, **Texas Method**, **nSuns 531 LP**, **5/3/1 Boring But Big**, **5/3/1 for Powerlifting**, **Upper/Lower 4-Day Split**, **PHUL**, **PHAT**, **Metallicadpa 6-Day PPL**, **Classic 5-Day Bro Split**, and more — each tagged by `level` and `goalFit` with an honest `evidenceTier`. A program's `schedule` is a list of `PlanDay`s; each day carries explicit prescribed `PlanLift`s (sets/rep range, optional `group` for supersets, per-lift `note`) and an optional per-day `goal` field that overrides the session's set/rep scheme.

## Key evidence (verified against primary sources)

- **ACSM 2009 position stand** ([PMID 19204579](https://pubmed.ncbi.nlm.nih.gov/19204579/)): novice 2–3 d/wk whole-body (cat A); intermediate 3–4 d/wk (cat B); advanced 4–6 d/wk (cat C). Sets: novice/intermediate 1–3/exercise, advanced 3–6. Strength needs ≥80% 1RM in trained lifters; novices gain even at 45–60%.
- **Frequency:** 2×/week beat 1×/week for hypertrophy ([Schoenfeld 2016, PMID 27102172](https://pubmed.ncbi.nlm.nih.gov/27102172/)) — but **when weekly volume is matched, frequency barely matters** ([volume-equated RCT, PMC8372753](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8372753/)). So "2×/week" is a practical floor for distributing volume.
- **Volume dose-response:** ~0.37% extra growth per added weekly set, with diminishing returns ([Schoenfeld 2017, PMID 27433992](https://pubmed.ncbi.nlm.nih.gov/27433992/); [Pelland 2024](https://pubmed.ncbi.nlm.nih.gov/41343037/)). Minimum effective volume rises as you advance.
- **Rep/intensity continuum (NSCA):** strength ≥85% 1RM / ≤6 reps; hypertrophy 67–85% / 6–12; endurance <67% / >12.
- **Rest:** ~2–3 min even for hypertrophy beats 1 min ([Schoenfeld 2016, PMID 26605807](https://pubmed.ncbi.nlm.nih.gov/26605807/)). Load is interchangeable for size but **heavy load is required for strength** ([Schoenfeld 2017, PMID 28834797](https://pubmed.ncbi.nlm.nih.gov/28834797/)).
- **Beginner exercise selection:** adding isolation work gave no extra gains over compounds in untrained men over 10 weeks ([Gentil 2013](https://cdnsciencepub.com/doi/abs/10.1139/apnm-2012-0176)) → compound-focused. Variety should increase with advancement but be *purposeful*, not random ([Kassiano/Schoenfeld 2022, PMID 35438660](https://pubmed.ncbi.nlm.nih.gov/35438660/)).
- **Progression model:** DUP beat linear in one small study ([Rhea 2002, PMID 11991778](https://pubmed.ncbi.nlm.nih.gov/11991778/)) but later volume-equated work found little difference ([Grgic 2017, PMC5571788](https://pmc.ncbi.nlm.nih.gov/articles/PMC5571788/)). Consensus: **at equated volume, periodization model matters far less than total volume**; DUP's real edge is fatigue management and adherence.

## Flagged / convention (not trial-proven)
Split-to-level mapping, MEV/MAV/MRV exact numbers, deload magnitude/frequency, and 48–72h recovery are coaching convention. The "10–20 sets/week" figure is downstream guidance, not a single-study finding.
