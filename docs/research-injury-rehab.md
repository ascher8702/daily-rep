# Research — Injury-aware training & therapeutic exercise

Grounding for Daily Rep's injury / "train around it" + rehab feature. Drives the data model
(`src/types.ts` `Injury`/`BodyRegion`), the region→avoid mappings and rehab catalog
(`src/lib/injuries.ts`, `src/data/rehab.ts`), and the safety copy. Citations inline.

## Thesis — modify & load, don't rest & avoid

For the vast majority of lifting injuries (tendinopathies, Grade I–II strains, non-specific low-back
pain) the evidence-based response is **relative rest + graded loading**, not total rest. Complete rest
detrains tissue and reduces resilience ([Barbell Medicine](https://www.barbellmedicine.com/blog/recovering-from-an-injury-embrace-the-process/));
the originator of "RICE" retracted it in 2014 ([Mirkin](https://drmirkin.com/fitness/why-ice-delays-recovery.html));
"PEACE & LOVE" (Dubois & Esculier, 2019 BJSM) explicitly encodes early **L**oading and **E**xercise
([PTSMC](https://ptsmc.com/rice-vs-peace-and-love/)). Bed rest is not effective for acute LBP
([PMC1410119](https://pmc.ncbi.nlm.nih.gov/articles/PMC1410119/)).

The app's job: (a) reduce/swap load on the painful region while keeping the user training everything
else, (b) offer graded therapeutic accessory work gated by a pain rule, (c) detect red flags and route
those users to a clinician. This maps to: a body-region taxonomy, per-region "loads/safe/rehab" tags,
a severity gate, and a red-flag interceptor.

## Region taxonomy (ranked by real prevalence)

Big three for lifters: **shoulder, low back, knee** ([PMC11624822](https://pmc.ncbi.nlm.nih.gov/articles/PMC11624822/),
[PMC6201188](https://pmc.ncbi.nlm.nih.gov/articles/PMC6201188/)). Second tier: elbow, wrist, hip, neck,
hamstring, ankle.

Exercise→region load map (encoded as the generator's avoid mappings):

| Exercise / pattern | Loads (avoid/modify) |
|---|---|
| Bench press | shoulder, neck, wrist |
| Overhead press | shoulder, neck |
| Deadlift / hinge | low back, proximal hamstring, elbow (grip), neck (lockout) |
| Deep squat | knee, hip (FAI), low back, ankle, wrist (front rack) |
| RDL / stiff-leg | proximal hamstring tendon |
| Pulls / rows / carries | elbow (both sides), wrist (TFCC) |
| Shrugs / upright rows | neck (upper trap) |

Biomechanics worth encoding as high-confidence flags: patellar-tendon force rises with knee-flexion
angle ([PMC2971642](https://pmc.ncbi.nlm.nih.gov/articles/PMC2971642/)); FAI provoked by deep flexion +
internal rotation ([JTS](https://www.jtsstrength.com/the-hip-impingement-solution/)); bench is the lift
most associated with shoulder injury ([PMC5954586](https://pmc.ncbi.nlm.nih.gov/articles/PMC5954586/)).

## Severity → behavior (our mild/moderate/severe ladder)

Maps to the pain-monitoring "traffic light" (Silbernagel 2007 AJSM):

- **mild (green, 0–3/10)** — keep training; drop only the aggravating *movement patterns*.
- **moderate (amber, 4–5/10)** — acceptable only if pain settles by next morning; avoid lifts that load
  the area (primary mover); lead with rehab.
- **severe (red, 6+/10)** — stop loading; avoid the area as a secondary mover too; rehab only.

The 24-hour rule governs progression: pain may reach ~5/10 during loading but must return to baseline by
next morning and not trend up week-to-week
([Silbernagel/AJSM](https://journals.sagepub.com/doi/abs/10.1177/0363546506298279),
[E3 Rehab](https://e3rehab.com/how-to-rehab-tendon-injuries-and-pain/)).

## Therapeutic toolkit (drives data/rehab.ts)

- **Isometrics** for analgesia/early loading (e.g. wall sit, Spanish squat, neck/quad isometrics). May
  help some users; effect is contested — present as "may help," not guaranteed (Rio 2015, n=6, load 70%
  1RM — [PubMed 25979840](https://pubmed.ncbi.nlm.nih.gov/25979840/); [PMC7406028](https://pmc.ncbi.nlm.nih.gov/articles/PMC7406028/)).
- **Heavy Slow Resistance / eccentrics** for tendons, 3s up/3s down (Beyer 2015
  [PubMed 26018970](https://pubmed.ncbi.nlm.nih.gov/26018970/); Alfredson eccentric heel drops — lower
  volume non-inferior, [PubMed 24261927](https://pubmed.ncbi.nlm.nih.gov/24261927/)).
- **McGill Big 3** (curl-up, side plank, bird-dog) for low back — spine-neutral core endurance
  ([Squat University](https://squatuniversity.com/2018/06/21/the-mcgill-big-3-for-core-stability/)).
- **Shoulder:** band external rotation, scapular wall slides, face pulls, Y/T raises
  ([E3 Rehab](https://e3rehab.com/rotator-cuff-exercises/), [OrthoInfo](https://orthoinfo.aaos.org/en/recovery/rotator-cuff-and-shoulder-conditioning-program/)).
- **Elbow:** eccentric wrist extension/flexion (FlexBar "Tyler Twist", RCT 81% vs 22% —
  [PMC2971639](https://pmc.ncbi.nlm.nih.gov/articles/PMC2971639/)).
- **Knee:** isometric knee extension/wall sit/Spanish squat, terminal knee extension, step-downs
  ([PMC7716685](https://pmc.ncbi.nlm.nih.gov/articles/PMC7716685/), [E3 Rehab](https://e3rehab.com/patellartendinopathy/)).
- **Hip:** clamshells, side-plank abduction, lateral walks, glute bridges, hip-flexor stretch
  ([Prehab Guys](https://landing.theprehabguys.com/the-best-exercises-for-the-glute-med/)). Caveat: for
  *lateral hip / gluteal tendinopathy* avoid clamshells early — adduction compresses the tendon
  ([Grimaldi](https://dralisongrimaldi.com/blog/ban-the-clam-exercise/)).
- **Hamstring:** isometric long-lever bridge → Nordic eccentric + RDL (Nordic biases short head; ~80% of
  strains hit BF long head, loaded by hip extension — [Prehab Guys](https://theprehabguys.com/nordic-hamstring-curl-variations/)).
- **Ankle:** eccentric heel drops, knee-to-wall dorsiflexion, single-leg balance
  ([Squat University](https://squatuniversity.com/2019/01/06/rehabbing-achilles-tendinopathy/)).
- **Neck:** chin tucks, 4-direction isometric holds, upper-trap stretch.

Dosing defaults: isometrics 3–5 × 30–45s; eccentrics 3 × 12–15 slow; mobility 2–3 × 30s; McGill Big 3 in
a descending-rep pyramid with ~10s holds. Place rehab loading at the start of a session, 2–3×/week; daily
is fine for low-load isometrics/mobility ([Barbell Medicine](https://www.barbellmedicine.com/blog/tendinopathy-guide/)).

## Safety / scope / liability (drives the disclaimer + red flags)

Stay on the FDA "general wellness" side: **no diagnose/treat/cure/mitigate claims**
([FDA](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/general-wellness-policy-low-risk-devices)).
Trainer scope of practice = screen & refer, never diagnose/treat/rehabilitate
([NASM](https://blog.nasm.org/personal-trainer-role-circle-of-care)). Frame rehab moves as "general
strengthening & mobility," not "physical therapy / treatment."

Disclaimer wording (mirrors Fitbod's verified in-product text): *"not medical advice and cannot replace
professional guidance. Always consult a qualified healthcare professional before exercising with an
injury."* ([Fitbod](https://help.fitbod.me/hc/en-us/articles/37629269518103-Injuries-and-Limitations)).

Red flags → STOP & refer (do not program around): saddle anesthesia / bladder-bowel changes (cauda
equina — emergency), numbness/tingling/weakness, pain radiating down a limb, joint locking / giving way,
significant swelling, night/rest pain, suspected fracture/trauma
([Cleveland Clinic](https://my.clevelandclinic.org/health/diseases/22132-cauda-equina-syndrome),
[Physio-pedia](https://www.physio-pedia.com/Red_Flags_in_Spinal_Conditions)).

## How peer apps do it (UX reference)

- **Fitbod** — "Injuries & Limitations": select a body part → excludes loading exercises, recommends
  alternatives, one-tap "Mark as not injured," carries the disclaimer above.
- **Hevy** — no injury feature; per-exercise "Replace" + "Don't recommend again."
- **Freeletics "Limitations"** — explicitly DOMS-only, warns *not* to use for injury (cautionary).
- **Hinge/Sword/Kaia** — regulated, clinician-supervised; a consumer app must not mimic their claims.

Recommended flow: body-region tap → severity (0–10 → mild/mod/severe) → red-flag screen → severity gates
programming → store per-region severity → re-prompt on a cadence → one-tap "recovered."

## Confidence

Strong (RCT / peer-reviewed): RICE retraction, Cook & Purdam continuum, Silbernagel pain model,
Beyer/Kongsgaard HSR, Tyler FlexBar, McGill Big 3, knee-flexion→patellar-force biomechanics, the
regulatory/scope/red-flag material. Lower-confidence / individualize: isometric analgesia is contested;
Alfredson 180-rep volume likely unnecessary; some neck/hip/wrist set-rep numbers are practitioner
consensus, not RCT-derived; the green/amber/red cutoffs are a convention, not a single standard.
