-- Two new catalogue exercises added to data/exercises.ts (kettlebell movements for the
-- Simple & Sinister and The Giant plans). Re-seed exercise_facts so the server-side analytics
-- projection covers them. Derived per the catalogue contract:
--   is_bodyweight_lift = equipment ∋ bodyweight AND category ∈ {compound,isolation}  -> false (kettlebell)
--   regions            = DISTINCT MUSCLES[primary].region
--     kb-clean-press  primary {shoulders}      -> {push}
--     turkish-get-up  primary {shoulders,abs}  -> {push,core}
insert into public.exercise_facts (exercise_id, is_bodyweight_lift, regions) values
  ('kb-clean-press', false, '{push}'),
  ('turkish-get-up', false, '{push,core}')
on conflict (exercise_id) do update
  set is_bodyweight_lift = excluded.is_bodyweight_lift,
      regions            = excluded.regions;
