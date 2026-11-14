-- Demo data matching the dashboard mockup (app/mockup/). All values are made up.
-- Runs automatically after migrations on `supabase db reset`.
--
-- Loudness is in the wire format's units: peak_level is tenths of a dB (898 = 89.8 dB), and
-- peak_db is computed from it. The levels are what the mockup's sound model gives for a
-- whistle at Ridge Camp: ~90 dB at the calling node, fading with distance (inverse square plus
-- absorption) to the nodes that confirm it, down to the 50 dB wake trigger.

insert into public.nodes (node_id, uid, num, name, role, lat, lon, elevation_m, battery_pct, millivolts, rssi_dbm, hops_to_base, last_heard_at, firmware) values
	(1,     null,               0, 'Ranger Station',        'base',  35.32099, -120.67781, null, null, null, null, 0, now(),                         'base 0.1.0'),
	(7246,  'E6614C311B2A7D40', 1, 'Lower Creek Trailhead', 'field', 35.32279, -120.67430, 1517,   92, 4110,  -58, 1, now() - interval '3 seconds',  '0.1.0-arm'),
	(31490, 'E6614C311B5E1C93', 2, 'Cedar Switchback',      'field', 35.32516, -120.67123, 1906,   81, 4020,  -66, 2, now() - interval '5 seconds',  '0.1.0-arm'),
	(14975, 'E6614C311B5A9F2D', 3, 'Falls Overlook',        'field', 35.32290, -120.66772, 1823,   64, 3880,  -71, 2, now() - interval '7 seconds',  '0.1.0-arm'),
	(55573, 'E6614C311B61F0A8', 4, 'Granite Saddle',        'field', 35.32628, -120.66531, 2141,   47, 3790,  -77, 3, now() - interval '9 seconds',  '0.1.0-arm'),
	(21190, 'E6614C311B7342E1', 5, 'Ridge Camp',            'field', 35.32786, -120.66136, 2286,   18, 3520,  -84, 4, now() - interval '11 seconds', '0.1.0-arm');
-- node_id is the u16 mesh ID: 0x1C4E = 7246, 0x7B02 = 31490, 0x3A7F = 14975, 0xD915 = 55573, 0x52C6 = 21190.

-- This morning's false positive at Ridge Camp, already resolved.
with a as (
	insert into public.alerts (src_node_id, msg_id, class, confidence, peak_level, blast_count, hops, latency_ms,
		node_uptime_ms, est_lat, est_lon, search_radius_m, summary, status, note, received_at, acknowledged_at, resolved_at)
	values (21190, 286, 'whistle', 0.62, 898, 3, 4, 446,
		21400000, 35.32776, -120.66153, 245,
		'Repeated distress whistle, likely 3 blasts, heard first and loudest by Serranode 05 · Ridge Camp (89.8 dB) at 09:12. 2 nearby Serranodes confirmed it more quietly (59.3 dB, 50.2 dB), narrowing the search to about 250 m around grid G2.',
		'resolved', 'Resolved. Bird call, false positive.', date_trunc('day', now()) + interval '9 hours 12 minutes 44 seconds',
		date_trunc('day', now()) + interval '9 hours 13 minutes 20 seconds', date_trunc('day', now()) + interval '9 hours 21 minutes 5 seconds')
	returning id
)
insert into public.alert_readings (alert_id, node_id, peak_level, confidence, is_first, received_at)
select a.id, r.node_id, r.peak_level, r.confidence, r.is_first, date_trunc('day', now()) + interval '9 hours 12 minutes 44 seconds'
from a, (values
	(21190, 898, 0.62, true),   -- Ridge Camp, heard first: 89.8 dB
	(55573, 593, 0.41, false),  -- Granite Saddle, 400 m away: 59.3 dB
	(14975, 502, 0.33, false)   -- Falls Overlook, 800 m away: 50.2 dB, just over the wake trigger
) as r (node_id, peak_level, confidence, is_first);
