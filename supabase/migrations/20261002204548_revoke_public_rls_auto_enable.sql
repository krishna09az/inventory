-- public.rls_auto_enable() is Supabase's "auto-enable RLS" event-trigger function (created with
-- the project). Being in the public schema, it's exposed at /rest/v1/rpc/rls_auto_enable to
-- anon and signed-in users, which the security advisor flags. Event-trigger functions can't be
-- called directly anyway, and the ensure_rls event trigger doesn't need these grants to fire.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
