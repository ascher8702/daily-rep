-- Defense-in-depth: the subscriptions row is read-only to end users by RLS (only a SELECT policy
-- exists). Make that intent enforced by GRANTS too, so a future permissive write policy added by
-- mistake can't immediately hand users the ability to self-grant Pro. Writes are performed only by the
-- service role (webhook) and the SECURITY DEFINER signup trigger, neither of which needs these grants.
revoke insert, update, delete on public.subscriptions from authenticated;
revoke insert, update, delete on public.subscriptions from anon;
