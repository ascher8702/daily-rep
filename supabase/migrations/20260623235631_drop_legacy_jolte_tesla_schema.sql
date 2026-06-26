-- Remove the leftover Tesla/Jolte app objects from the reused project.
-- Preserves FitForge's own objects: public.fitforge_state + public.fitforge_touch_updated_at,
-- and all Supabase-managed schemas (auth/storage/realtime/vault/supabase_migrations).

-- 1) Jolte view(s)
drop view if exists public.tesla_tokens_secure cascade;

-- 2) Leftover Tesla/Jolte tables in public (everything except fitforge_state)
drop table if exists
  public.achievements, public.ai_insights, public.ai_summary_cache, public.alert_events,
  public.automation_logs, public.automations, public.battery_health, public.battery_snapshots,
  public.blog_posts, public.charge_sessions, public.charging_invoices, public.daily_stats,
  public.drive_sessions, public.driving_behavior_events, public.efficiency_scores,
  public.electricity_rates, public.feature_requests, public.feature_status_history,
  public.feature_votes, public.feedback, public.fsd_sessions, public.geofences,
  public.insight_notifications, public.invoice_settings, public.irs_mileage_rates,
  public.leaderboard_entries, public.notification_events, public.phantom_drain_events,
  public.push_subscriptions, public.referral_events, public.referrals, public.saved_locations,
  public.saved_trips, public.scheduled_commands, public.security_events,
  public.software_release_notes, public.software_update_stats, public.software_updates,
  public.stripe_customers, public.stripe_webhook_events, public.subscriptions,
  public.support_tickets, public.tesla_tokens, public.user_achievements, public.user_dashboards,
  public.user_preferences, public.user_rate_settings, public.vehicle_alerts,
  public.vehicle_software_status, public.vehicles, public.waitlist, public.waitlist_drip_log,
  public.widget_types
  cascade;

-- 3) Custom admin schema (admin_users, import_batches, roadmap_items)
drop schema if exists admin cascade;

-- 4) Jolte functions (explicit allow-list; loop handles any overloads, never touches fitforge_* or extensions)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'cleanup_old_data','decrypt_token','decrypt_user_token','distinct_car_versions',
        'encrypt_tesla_tokens_trigger','encrypt_token','encrypt_user_token',
        'generate_invoice_number','get_latest_battery_snapshots','get_token_encryption_key',
        'increment_referral_count','increment_referral_total','increment_trigger_count',
        'is_admin','is_admin_user','is_superadmin_user','track_feature_status_change',
        'update_feature_request_timestamp','update_feedback_timestamp',
        'update_subscriptions_updated_at','update_support_ticket_timestamp',
        'update_user_dashboards_updated_at'
      )
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

-- 5) Jolte enum types
drop type if exists public.alert_type cascade;
drop type if exists public.automation_action_type cascade;
drop type if exists public.automation_log_status cascade;
drop type if exists public.automation_trigger_type cascade;
drop type if exists public.command_status cascade;
drop type if exists public.command_type cascade;
