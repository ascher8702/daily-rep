-- Stage 2 math primitives — must match src/lib/stats.ts + format.ts exactly.
-- effectiveLoad: bodyweight lifts add round(bw*0.65) (BW_LOAD_FRACTION); else raw external load.
create or replace function analytics.effective_weight(p_is_bw boolean, p_bw numeric, p_weight numeric)
returns numeric language sql immutable set search_path to 'pg_catalog' as
$$ select case when p_is_bw and p_bw > 0 then round(p_bw * 0.65) + p_weight else p_weight end $$;

-- display-unit value -> kg (unrounded), for cross-user aggregation. 1 kg = 2.20462 lb.
create or replace function analytics.to_kg(p_v numeric, p_unit text)
returns numeric language sql immutable set search_path to 'pg_catalog' as
$$ select case when p_unit = 'lb' then p_v / 2.20462 else p_v end $$;

-- mirror the client's sanitizeWorkout gate: only COMPLETED workouts with an id and an exercises array.
create or replace function analytics.is_projectable(w jsonb)
returns boolean language sql immutable set search_path to 'pg_catalog' as
$$ select w->>'status' = 'completed' and coalesce(w->>'id','') <> '' and jsonb_typeof(w->'exercises') = 'array' $$;

-- math sanity (returned by this migration via a trailing select is not supported; verify separately)
