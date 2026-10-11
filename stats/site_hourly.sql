-- Run once in Supabase (SQL editor). Hourly waitlist visits + signups, counts only, so the reply bot
-- can line signups up with the reply style that was running that hour.
create or replace function public.site_hourly() returns table(hour timestamptz, views bigint, signups bigint)
language sql security definer set search_path = '' stable as $$
  select date_trunc('hour', at),
    count(*) filter (where kind = 'view'),
    count(*) filter (where kind = 'signup')
  from public.site_events where at > now() - interval '30 days'
  group by 1 order by 1 $$;
revoke all on function public.site_hourly() from public;
grant execute on function public.site_hourly() to anon, authenticated;
