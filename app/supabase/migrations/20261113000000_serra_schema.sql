-- Serra base station schema.
--
-- Writers: the base-station BLE listener (Python + bleak) decodes Serranet packets and writes here
-- with the service_role key, which bypasses row level security.
-- Readers: the dashboard uses the anon key. It can read everything, and can only change an alert's
-- status (acknowledge / resolve). Realtime is on for every table so the dashboard updates live.
--
-- Field names follow the packet structs in the README's "Mesh protocol (Serranet)" section.
-- If the wire format changes, update this file in the same PR (see CONTRIBUTING.md).

-- ───────────── Serranodes and the base ─────────────
create table public.nodes (
	node_id        integer primary key check (node_id between 0 and 65535), -- mesh_pkt_t.src, derived from the flash ID
	uid            text unique,                                              -- full flash serial, e.g. E6614C311B5A9F2D
	num            smallint unique,                                          -- display number: N01, N02, ...
	name           text not null,                                            -- "Falls Overlook"
	role           text not null default 'field' check (role in ('field', 'base')),
	lat            double precision,                                         -- set when the node is placed
	lon            double precision,
	elevation_m    real,
	battery_pct    smallint check (battery_pct between 0 and 100),           -- from HEARTBEAT (proposed payload)
	millivolts     integer,
	rssi_dbm       smallint,                                                 -- signal of the last packet the base heard
	hops_to_base   smallint,
	last_heard_at  timestamptz,
	firmware       text,
	created_at     timestamptz not null default now()
);

comment on table public.nodes is 'Serranodes and the base station. Positions are entered when a node is placed (the Pico has no GPS).';

-- ───────────── Alerts: one row per distress event ─────────────
-- The base station groups copies of the same call heard by several nodes (arrivals within ~2 s)
-- into one alert. The node that heard it loudest is the source; the rest are in alert_readings.
create table public.alerts (
	id               bigint generated always as identity primary key,
	src_node_id      integer not null references public.nodes (node_id),
	msg_id           integer not null check (msg_id between 0 and 65535),
	class            text not null check (class in ('whistle', 'scream', 'help')),
	confidence       real not null check (confidence between 0 and 1),     -- alert_payload_t.confidence / 255
	peak_level       integer not null,                                      -- alert_payload_t.peak_level (raw)
	peak_db          real,                                                  -- calibrated loudness
	blast_count      smallint,                                              -- 3 = distress whistle pattern
	hops             smallint,                                              -- 4 - ttl on arrival
	latency_ms       integer,
	node_uptime_ms   bigint,                                                -- alert_payload_t.timestamp (per-node uptime, not synced)
	est_lat          double precision,                                      -- loudness-weighted fix from all readings
	est_lon          double precision,
	search_radius_m  real,
	summary          text,                                                  -- plain-language sentence for the alert card
	status           text not null default 'active' check (status in ('active', 'ack', 'resolved')),
	note             text,
	received_at      timestamptz not null default now(),
	acknowledged_at  timestamptz,
	resolved_at      timestamptz,
	unique (src_node_id, msg_id, received_at)
);

create index alerts_received_at_idx on public.alerts (received_at desc);
create index alerts_open_idx on public.alerts (status) where status <> 'resolved';

comment on table public.alerts is 'One distress event. status: active -> ack -> resolved.';

-- Every Serranode that heard the call, the loudest first. These narrow down the search area.
create table public.alert_readings (
	alert_id     bigint not null references public.alerts (id) on delete cascade,
	node_id      integer not null references public.nodes (node_id),
	peak_level   integer not null,
	peak_db      real,
	confidence   real check (confidence between 0 and 1),
	is_first     boolean not null default false,                          -- heard it first and loudest
	received_at  timestamptz not null default now(),
	primary key (alert_id, node_id)
);

comment on table public.alert_readings is 'Per-node readings of one alert: the calling node plus every node confirming it more quietly.';

-- ───────────── Raw Serranet packets (log) ─────────────
create table public.packets (
	id           bigint generated always as identity primary key,
	received_at  timestamptz not null default now(),
	src_node_id  integer references public.nodes (node_id),
	msg_id       integer,
	ttl          smallint,
	type         text not null check (type in ('ALERT', 'HEARTBEAT')),
	raw          bytea not null,                                          -- manufacturer data bytes as received
	decoded      jsonb                                                    -- field-by-field decode for the packet view
);

create index packets_received_at_idx on public.packets (received_at desc);

comment on table public.packets is 'Deduplicated Serranet packets, newest first. Drives the raw packet view.';

-- Alert status changes stamp their own times.
create function public.stamp_alert_status() returns trigger
language plpgsql as $$
begin
	if new.status = 'ack' and old.status is distinct from 'ack' then
		new.acknowledged_at := coalesce(new.acknowledged_at, now());
	end if;
	if new.status = 'resolved' and old.status is distinct from 'resolved' then
		new.resolved_at := coalesce(new.resolved_at, now());
	end if;
	return new;
end;
$$;

create trigger alerts_stamp_status before insert or update of status on public.alerts
	for each row execute function public.stamp_alert_status();

-- ───────────── Access ─────────────
alter table public.nodes enable row level security;
alter table public.alerts enable row level security;
alter table public.alert_readings enable row level security;
alter table public.packets enable row level security;

create policy "dashboard reads nodes" on public.nodes for select to anon, authenticated using (true);
create policy "dashboard reads alerts" on public.alerts for select to anon, authenticated using (true);
create policy "dashboard reads readings" on public.alert_readings for select to anon, authenticated using (true);
create policy "dashboard reads packets" on public.packets for select to anon, authenticated using (true);

-- The dashboard may only acknowledge / resolve alerts and add a note.
create policy "dashboard updates alert status" on public.alerts for update to anon, authenticated
	using (true) with check (true);
revoke update on public.alerts from anon, authenticated;
grant update (status, note) on public.alerts to anon, authenticated;

-- ───────────── Realtime ─────────────
alter publication supabase_realtime add table public.nodes, public.alerts, public.alert_readings, public.packets;
