-- pin the trigger function's search_path (security hardening; addresses function_search_path_mutable)
create or replace function public.fitforge_touch_updated_at()
  returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
