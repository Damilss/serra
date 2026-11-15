# 2026-11-15: Outdoor lawn test, peak levels after the 56 dB recalibration

First outdoor run with all three nodes after `d7db8f7` (`fix(firmware): calibrate peak levels to a sound level meter (56 dB)`). Absolute levels now look believable: shouts next to a node read 80 to 104 dB, and the same shouts from across the triangle read 45 to 70 dB. But the nodes don't agree with each other. When all three hear the same sound, **0x2D9A reads loudest 15 times out of 24 and 0x0B16 reads quietest 20 times out of 24**, even though the sounds came from all over the triangle.

The skew matches the per-node calibration offsets. Take the offsets out and the three nodes agree within 1 dB on average. The bench calibration is the likely cause, not the mics or their placement.

## Setup

| | |
|---|---|
| Nodes | 0x0B16, 0xED70, 0x2D9A. All three on INMP441 I2S mics since the rewiring |
| Firmware | `main` at `b62c7b4` (merge of `d7db8f7`). Offsets from `calib_table` in `firmware/audio/listen.c`: 0x0B16 +98.8 dB (988), 0xED70 +104.4 dB (1044), 0x2D9A +109.0 dB (1090). Target: the 1 kHz reference tone reads 56 dB (`LISTEN_CALIB_TARGET_DB_X10 = 560`) |
| Base station | Pi 5 in USB gadget mode, decoder serving SSE; laptop reading it with `curl -N http://10.12.194.1:8080/events` |
| Site | Outdoors on a lawn, nodes in a triangle. No walls nearby, so few reflections. Exact node spacing wasn't recorded |
| Sounds | Shouted "help", screams and whistles, made from various spots across the triangle (near each node and in between) |

## Analysis

The log has 137 `ALERT` packets, SSE `seq` 36 to 172 of run `31618d`, about 25 minutes. Every packet's `raw` bytes were decoded and checked against its JSON fields; all 137 match.

### Per node

| Node | Packets | Median `peak_db` | Help (median) | Scream (median) | Whistle (median) | Median RSSI at the Pi |
|---|---|---|---|---|---|---|
| 0x0B16 | 48 | 58.5 | 57.1 | 61.9 | 50.8 | -69 dBm |
| 0xED70 | 47 | 69.8 | 73.2 | 69.0 | 73.1 | -71 dBm |
| 0x2D9A | 42 | 72.0 | 67.6 | 73.4 | 72.0 | -61.5 dBm |

These medians mix sounds from different spots, so on their own they don't prove anything. The useful comparison is the one below: the same sound, heard by all three nodes at once.

### Sounds all three nodes heard

Packets that arrive within 1.5 s of each other are treated as one sound. 24 sounds were heard by all three nodes (0x2D9A only came online at t ≈ 734 s). If a node sent two packets for one sound, the louder is used. `t` is the decoder's `t_ms` in seconds.

| t (s) | Class | 0x0B16 | 0xED70 | 0x2D9A | Loudest | Quietest | Spread (dB) | `seq` |
|---|---|---|---|---|---|---|---|---|
| 776.3 | help | 66.7 | 69.3 | **76.4** | 0x2D9A | 0x0B16 | 9.7 | 70, 71, 72 |
| 894.2 | scream | 70.1 | 69.1 | **75.8** | 0x2D9A | 0xED70 | 6.7 | 75, 76, 77 |
| 917.8 | scream | 63.0 | **79.2** | 75.3 | 0xED70 | 0x0B16 | 16.2 | 78, 79, 80 |
| 933.8 | scream | 63.0 | **83.2** | 72.0 | 0xED70 | 0x0B16 | 20.2 | 81, 82, 83 |
| 954.7 | scream | 56.9 | 63.6 | **87.3** | 0x2D9A | 0x0B16 | 30.4 | 85, 86, 87 |
| 993.4 | scream | 57.4 | 68.2 | **74.7** | 0x2D9A | 0x0B16 | 17.3 | 88, 89, 90 |
| 1041.4 | scream | 64.3 | 69.8 | **72.3** | 0x2D9A | 0x0B16 | 8.0 | 95, 96, 97, 98 |
| 1070.8 | help/scream | 67.5 | 71.4 | **76.1** | 0x2D9A | 0x0B16 | 8.6 | 101, 102, 103 |
| 1100.9 | scream | 56.3 | 67.3 | **73.4** | 0x2D9A | 0x0B16 | 17.1 | 105, 106, 107 |
| 1123.4 | scream | 60.4 | 67.8 | **79.1** | 0x2D9A | 0x0B16 | 18.7 | 108, 109, 110 |
| 1383.4 | scream | 55.7 | 61.5 | **79.6** | 0x2D9A | 0x0B16 | 23.9 | 119, 120, 121 |
| 1428.1 | scream | 59.1 | 61.8 | **88.7** | 0x2D9A | 0x0B16 | 29.6 | 122, 123, 124 |
| 1560.3 | scream | **80.4** | 70.1 | 77.2 | 0x0B16 | 0xED70 | 10.3 | 128, 129, 130 |
| 1582.4 | scream | **83.6** | 71.3 | 70.6 | 0x0B16 | 0x2D9A | 13.0 | 132, 133, 134 |
| 1606.7 | scream | **85.6** | 68.9 | 69.8 | 0x0B16 | 0xED70 | 16.7 | 136, 137, 138 |
| 1643.8 | whistle | 68.9 | **72.8** | 72.5 | 0xED70 | 0x0B16 | 3.9 | 141, 142, 143 |
| 1649.6 | help | 47.9 | 56.2 | **59.2** | 0x2D9A | 0x0B16 | 11.3 | 144, 145, 146 |
| 1660.9 | whistle | 65.9 | **74.5** | 72.0 | 0xED70 | 0x0B16 | 8.6 | 147, 148, 149 |
| 1696.7 | whistle | 53.3 | 75.1 | **77.2** | 0x2D9A | 0x0B16 | 23.9 | 151, 152, 153 |
| 1733.7 | whistle | 50.8 | **73.3** | 72.3 | 0xED70 | 0x0B16 | 22.5 | 156, 157, 158 |
| 1754.5 | whistle | 64.8 | **76.2** | 70.6 | 0xED70 | 0x0B16 | 11.4 | 159, 160, 161 |
| 1789.9 | scream | 60.8 | 73.0 | **74.4** | 0x2D9A | 0x0B16 | 13.6 | 162, 163, 164 |
| 1840.9 | whistle | 57.8 | 66.6 | **76.4** | 0x2D9A | 0x0B16 | 18.6 | 167, 168, 169 |
| 1854.4 | whistle | 40.6 | 48.1 | **49.6** | 0x2D9A | 0x0B16 | 9.0 | 170, 171, 172 |

| | 0x0B16 | 0xED70 | 0x2D9A |
|---|---|---|---|
| Loudest (of 24) | 3 | 6 | **15** |
| Quietest (of 24) | **20** | 3 | 1 |
| Bias: mean of (node − average of the three) | **−6.0 dB** | +0.6 dB | **+5.4 dB** |
| Same, with the calibration offsets taken out | −0.7 dB | +0.3 dB | +0.4 dB |
| Loudest with the offsets taken out (of 24) | 8 | 9 | 7 |

**How to read the bias row:** for each sound, take each node's reading minus the average of the three. If the sounds come from all around the triangle, how far each node was from the sound mostly averages out, and what's left is the node's own bias. (The same calculation with medians instead of means gives −7.6 / +1.2 / +4.6 dB with the offsets and −2.3 / +0.9 / −0.3 dB without.)

**What it shows:**

- **0x2D9A and 0x0B16 are about 11 dB apart.** 0x2D9A reads about 5 dB high and 0x0B16 about 6 dB low; 0xED70 sits in the middle.
- **The gap equals the gap between their offsets.** 0x2D9A's offset is 10.2 dB above 0x0B16's and 4.6 dB above 0xED70's. With the offsets taken out, every node's bias is under 1 dB, and the loudest node is spread almost evenly (8 / 9 / 7). That's what you'd expect when one person walks around the triangle.
- **Taking the offsets out also halves the disagreement.** The median gap between the loudest and quietest node for a sound drops from 14.9 dB to 8.4 dB. What's left is mostly the real distance differences we want to measure.
- **It holds for every part of the run.** Before t = 1300 s (10 sounds): bias −7.3 / +1.0 / +6.3 dB. After (14 sounds): −5.0 / +0.3 / +4.7 dB. On voice alone (17 sounds): −5.0 / −0.7 / +5.8 dB.
- **Close to a node, distance still wins.** At t = 1560 to 1607 s, someone shouted near 0x0B16, and 0x0B16 read loudest at 80 to 86 dB, 9 to 17 dB above the others, despite its −6 dB bias. The bias decides the result in the middle of the triangle, where real level differences are small. That's exactly where loudness-based location needs it to be right.

For location, 11 dB between two nodes is about a 3.5× error in distance: a person standing in the middle looks much closer to 0x2D9A than to 0x0B16.

### Offsets estimated from the lawn data

Subtract each node's bias from its current offset to get the offset that would have zeroed it on this run:

| Node | Current offset | Lawn bias | Offset that cancels it |
|---|---|---|---|
| 0x0B16 | +98.8 dB | −6.0 dB | +104.8 dB |
| 0xED70 | +104.4 dB | +0.6 dB | +103.8 dB |
| 0x2D9A | +109.0 dB | +5.4 dB | +103.6 dB |

The three come out within 1.2 dB of each other. On this data, **the mics need essentially the same offset**, and the 10 dB spread from the bench is an artifact of the bench setup. Using one shared offset of about +104 dB (1040) keeps the absolute scale close to the meter, because it's the average of the current offsets.

### Why the bench calibration could be off

Before calibration, at the same spot with the same tone, the bench read 0x0B16 −42.8 dBFS, 0xED70 −48.4 dBFS and 0x2D9A −53.0 dBFS, a 10 dB spread. The INMP441's sensitivity is specified as −26 dBFS ±1 dB, so three working INMP441s shouldn't differ by 10 dB. The lawn data agrees: without offsets they read the same. Possible causes (none confirmed):

1. **Placement at 7 in.** At 18 cm from a phone speaker, small differences in angle or in which way the bottom-port mic faces can move a 1 kHz tone by several dB. Outdoors, from metres away, that doesn't happen. This fits the data best.
2. **A node running older firmware.** On the previous offsets (`8e124bf`: 0x0B16 1223, 0xED70 1167, 0x2D9A 1155), the nodes would read 6 to 24 dB higher, and not by the same amount each. Each node prints its offset on boot (`[listen] node 0x.... calibration offset ...`), so this is quick to check.
3. **A mic detected as bitstream.** `mic_init()` chooses I2S or bitstream from the incoming data at boot (`looks_like_bitstream()`). The boot line `[listen] mic (I2S) + classifier running on core 1` shows which one it chose.

### Other observations

- **0xED70 rebooted at least three times during the run.** Each reboot resets its uptime `timestamp` and picks a new random `msg_id` seed:

  | Seen at | Boot time (`t` − uptime) | New `msg_id` |
  |---|---|---|
  | `seq` 40, t = 379.4 s | ≈ 287.6 s (before the capture; possibly power-on) | 26579 |
  | `seq` 48, t = 460.4 s | ≈ 427.9 s | 16490 |
  | `seq` 119, t = 1383.4 s | ≈ 1326.3 s | 62338 |
  | `seq` 130, t = 1560.8 s | ≈ 1541.2 s | 30043 |

  0x0B16 and 0x2D9A didn't reboot after their first packet. The cause wasn't noted (battery, a loose connector, brown-out when the radio and classifier run together, someone handling it). The base station took the new `msg_id`s without dropping anything, so the random seed works as designed. But a node that drops out for about 30 s at a time is a reliability problem in its own right.
- **0x2D9A joined late.** Its boot was at about t = 734 s; before that only 0x0B16 and 0xED70 were reporting.
- **Relays are working.** 110 packets came direct, 26 over one hop and 1 over two hops (`seq` 128, 0x0B16 through both other nodes). Every (`src`, `msg_id`) pair appears once, so dedup held. `peak_db` is set by the node that heard the sound, so relaying doesn't change it.
- **Whistles show the same skew.** 0x0B16 was quietest on all 7 whistles heard by all three nodes (median 50.8 dB, against about 72 to 73 dB for the others). Without offsets, 0xED70 reads +3.4 dB on whistles, but 7 sounds are too few to separate that from where they were made.
- **Classifier.** All 137 detections were help, scream or whistle, as intended. Confidence was 0.70 or higher, and 1.0 on most whistles in the second half.
- **RSSI isn't related to the skew.** 0x2D9A has the strongest link to the Pi (median −61.5 dBm), which says where it sat relative to the base station, not relative to the person shouting.

## What this shows

- After the 56 dB recalibration, **absolute peak levels are believable.**
- **The nodes are skewed by up to 11 dB on a shared sound:** 0x2D9A reads about 5 dB high and 0x0B16 about 6 dB low, consistently across the run, for voice and whistles, from sounds all over the triangle.
- **The skew comes from the calibration offsets.** Without them, the three nodes agree within 1 dB on average. Offsets estimated from the lawn come out the same within 1.2 dB, so the 10 dB spread measured at the bench doesn't reflect the mics.
- **0xED70 reboots repeatedly**, at least three times in 25 minutes.

## What it does not show

- **Exact positions.** Spacing and where each sound came from weren't recorded. The bias estimate assumes the sounds were spread fairly evenly around the triangle, which matches how the test was run but wasn't measured. Different spots on different sides of the triangle would shift each node's bias by a dB or two, not 11.
- **Which firmware and mic mode each node was running.** Serial logs weren't captured on the lawn.
- **Why 0xED70 reboots.**
- **Anything before `seq` 36.** The capture starts mid-run.

## Next steps

1. **Check the boot lines** on all three nodes: offsets 988 / 1044 / 1090 for 0x0B16 / 0xED70 / 0x2D9A, and `I2S`. This rules out causes 2 and 3 in a couple of minutes.
2. **Give all three nodes the same offset** (about 1040). On this data, that brings every node's bias under 1 dB. If per-node offsets are needed later, measure them in the field rather than at 7 in.
3. **Confirm with a known-position test.** Mark the centre of the triangle (equal distance to all three nodes) and play the reference tone or shout there 5 times, then once at each midpoint between two nodes. Record the spacing. Equal distance should give equal `peak_db` within about 2 dB.
4. **Find 0xED70's reboots.** Watch its serial console (or power it from a bench supply) through a run and note the last line before each reset.

## Raw output

The full SSE stream, exactly as captured.

<details>
<summary>Full log: <code>curl -N http://10.12.194.1:8080/events</code>, <code>seq</code> 36 to 172</summary>

```text
emilio@Pro-M5-2 ~ $ curl -N http://10.12.194.1:8080/events
retry: 2000

id: 31618d:36
event: packet
data: {"run_id":"31618d","seq":36,"t_ms":354693,"rssi":-73,"raw":"5e160bffffc466040101eada01eb38090001","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26308,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":0.9176,"peak_level":474,"peak_db":47.4,"timestamp":604395,"blast_count":1}}

id: 31618d:37
event: packet
data: {"run_id":"31618d","seq":37,"t_ms":366588,"rssi":-73,"raw":"5e160bffffc566040103fe8703cc67090000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26309,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":0.9961,"peak_level":903,"peak_db":90.3,"timestamp":616396,"blast_count":0}}

id: 31618d:38
event: packet
data: {"run_id":"31618d","seq":38,"t_ms":368585,"rssi":-76,"raw":"5e160bffffc666040103fb61035d6e090000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26310,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":0.9843,"peak_level":865,"peak_db":86.5,"timestamp":618077,"blast_count":0}}

id: 31618d:39
event: packet
data: {"run_id":"31618d","seq":39,"t_ms":378810,"rssi":-72,"raw":"5e160bffffc766040102c0b8039c97090000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26311,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.7529,"peak_level":952,"peak_db":95.2,"timestamp":628636,"blast_count":0}}

id: 31618d:40
event: packet
data: {"run_id":"31618d","seq":40,"t_ms":379392,"rssi":-78,"raw":"5e70edffffd367040102d83802be66010000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":26579,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.8471,"peak_level":568,"peak_db":56.8,"timestamp":91838,"blast_count":0}}

id: 31618d:41
event: packet
data: {"run_id":"31618d","seq":41,"t_ms":383727,"rssi":-70,"raw":"5e160bffffc866040101b4d9015eaa090001","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26312,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":0.7059,"peak_level":473,"peak_db":47.3,"timestamp":633438,"blast_count":1}}

id: 31618d:42
event: packet
data: {"run_id":"31618d","seq":42,"t_ms":386244,"rssi":-72,"raw":"5e160bffffc966040103f62702ccb2090000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26313,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":0.9647,"peak_level":551,"peak_db":55.1,"timestamp":635596,"blast_count":0}}

id: 31618d:43
event: packet
data: {"run_id":"31618d","seq":43,"t_ms":386974,"rssi":-76,"raw":"5e70edffffd467030103fd6e02df82010000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":26580,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"help","confidence":0.9922,"peak_level":622,"peak_db":62.2,"timestamp":99039,"blast_count":0}}

id: 31618d:44
event: packet
data: {"run_id":"31618d","seq":44,"t_ms":396830,"rssi":-71,"raw":"5e160bffffca66040103fe2f02ecdd090000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26314,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":0.9961,"peak_level":559,"peak_db":55.9,"timestamp":646636,"blast_count":0}}

id: 31618d:45
event: packet
data: {"run_id":"31618d","seq":45,"t_ms":397302,"rssi":-84,"raw":"5e70edffffd567040103ffb8030dad010000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":26581,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":1.0,"peak_level":952,"peak_db":95.2,"timestamp":109837,"blast_count":0}}

id: 31618d:46
event: packet
data: {"run_id":"31618d","seq":46,"t_ms":406318,"rssi":-78,"raw":"5e70edffffd667040102fd9c03abd0010000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":26582,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9922,"peak_level":924,"peak_db":92.4,"timestamp":118955,"blast_count":0}}

: ping

: ping

: ping

id: 31618d:47
event: packet
data: {"run_id":"31618d","seq":47,"t_ms":454425,"rssi":-69,"raw":"5e160bffffcb66040101e49f01eebe0a0002","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26315,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":0.8941,"peak_level":415,"peak_db":41.5,"timestamp":704238,"blast_count":2}}

id: 31618d:48
event: packet
data: {"run_id":"31618d","seq":48,"t_ms":460409,"rssi":-63,"raw":"5e70edffff6a40030103fff6022e7f000000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16490,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"help","confidence":1.0,"peak_level":758,"peak_db":75.8,"timestamp":32558,"blast_count":0}}

id: 31618d:49
event: packet
data: {"run_id":"31618d","seq":49,"t_ms":462560,"rssi":-71,"raw":"5e70edffff6b40040103ff2803af86000000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16491,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":1.0,"peak_level":808,"peak_db":80.8,"timestamp":34479,"blast_count":0}}

id: 31618d:50
event: packet
data: {"run_id":"31618d","seq":50,"t_ms":472158,"rssi":-60,"raw":"5e70edffff6c40030103ff32031fad000000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16492,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"help","confidence":1.0,"peak_level":818,"peak_db":81.8,"timestamp":44319,"blast_count":0}}

id: 31618d:51
event: packet
data: {"run_id":"31618d","seq":51,"t_ms":478112,"rssi":-63,"raw":"5e70edffff6d40040101de27038ec4000003","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16493,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":0.8706,"peak_level":807,"peak_db":80.7,"timestamp":50318,"blast_count":3}}

id: 31618d:52
event: packet
data: {"run_id":"31618d","seq":52,"t_ms":480133,"rssi":-64,"raw":"5e160bffffcc66040103ff10035e210b0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26316,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":1.0,"peak_level":784,"peak_db":78.4,"timestamp":729438,"blast_count":0}}

id: 31618d:53
event: packet
data: {"run_id":"31618d","seq":53,"t_ms":484578,"rssi":-59,"raw":"5e160bffffcd66040103ff4e031d340b0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26317,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":1.0,"peak_level":846,"peak_db":84.6,"timestamp":734237,"blast_count":0}}

id: 31618d:54
event: packet
data: {"run_id":"31618d","seq":54,"t_ms":493244,"rssi":-59,"raw":"5e70edffff6e40030101b63302aefe000003","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16494,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"whistle","confidence":0.7137,"peak_level":563,"peak_db":56.3,"timestamp":65198,"blast_count":3}}

id: 31618d:55
event: packet
data: {"run_id":"31618d","seq":55,"t_ms":500257,"rssi":-61,"raw":"5e160bffffce66040102e43202fc710b0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26318,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.8941,"peak_level":562,"peak_db":56.2,"timestamp":750076,"blast_count":0}}

id: 31618d:56
event: packet
data: {"run_id":"31618d","seq":56,"t_ms":500430,"rssi":-69,"raw":"5e70edffff6f40040102daa903c01b010000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16495,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.8549,"peak_level":937,"peak_db":93.7,"timestamp":72640,"blast_count":0}}

id: 31618d:57
event: packet
data: {"run_id":"31618d","seq":57,"t_ms":509651,"rssi":-72,"raw":"5e70edffff7040040102f810045f3f010000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16496,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9725,"peak_level":1040,"peak_db":104.0,"timestamp":81759,"blast_count":0}}

id: 31618d:58
event: packet
data: {"run_id":"31618d","seq":58,"t_ms":518487,"rssi":-64,"raw":"5e70edffff7140030102fd14040e62010000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16497,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"scream","confidence":0.9922,"peak_level":1044,"peak_db":104.4,"timestamp":90638,"blast_count":0}}

: ping

: ping

: ping

: ping

: ping

: ping

id: 31618d:59
event: packet
data: {"run_id":"31618d","seq":59,"t_ms":623058,"rssi":-71,"raw":"5e70edffff7240040102cded01ccfa020000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16498,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.8039,"peak_level":493,"peak_db":49.3,"timestamp":195276,"blast_count":0}}

id: 31618d:60
event: packet
data: {"run_id":"31618d","seq":60,"t_ms":623422,"rssi":-65,"raw":"5e160bffffcf66040102bd0b02fd510d0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26319,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.7412,"peak_level":523,"peak_db":52.3,"timestamp":872957,"blast_count":0}}

id: 31618d:61
event: packet
data: {"run_id":"31618d","seq":61,"t_ms":634901,"rssi":-73,"raw":"5e160bffffd066040103f6a502ec7f0d0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26320,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":0.9647,"peak_level":677,"peak_db":67.7,"timestamp":884716,"blast_count":0}}

: ping

id: 31618d:62
event: packet
data: {"run_id":"31618d","seq":62,"t_ms":661270,"rssi":-69,"raw":"5e70edffff7340030103f7dc02df8f030000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16499,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"help","confidence":0.9686,"peak_level":732,"peak_db":73.2,"timestamp":233439,"blast_count":0}}

id: 31618d:63
event: packet
data: {"run_id":"31618d","seq":63,"t_ms":674203,"rssi":-63,"raw":"5e70edffff7440040102ed39027ec2030000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16500,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9294,"peak_level":569,"peak_db":56.9,"timestamp":246398,"blast_count":0}}

id: 31618d:64
event: packet
data: {"run_id":"31618d","seq":64,"t_ms":674559,"rssi":-73,"raw":"5e160bffffd166040102fafb019d1a0e0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26321,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9804,"peak_level":507,"peak_db":50.7,"timestamp":924317,"blast_count":0}}

: ping

id: 31618d:65
event: packet
data: {"run_id":"31618d","seq":65,"t_ms":692314,"rssi":-68,"raw":"5e160bffffd266030103ff3b02fe5f0e0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26322,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"help","confidence":1.0,"peak_level":571,"peak_db":57.1,"timestamp":942078,"blast_count":0}}

id: 31618d:66
event: packet
data: {"run_id":"31618d","seq":66,"t_ms":705218,"rssi":-70,"raw":"5e160bffffd366040102f5d0039d920e0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26323,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9608,"peak_level":976,"peak_db":97.6,"timestamp":955037,"blast_count":0}}

id: 31618d:67
event: packet
data: {"run_id":"31618d","seq":67,"t_ms":716054,"rssi":-74,"raw":"5e70edffff7540040103ffda039e65040000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16501,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":1.0,"peak_level":986,"peak_db":98.6,"timestamp":288158,"blast_count":0}}

id: 31618d:68
event: packet
data: {"run_id":"31618d","seq":68,"t_ms":716116,"rssi":-73,"raw":"5e160bffffd466040103ff0202cbbc0e0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26324,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":1.0,"peak_level":514,"peak_db":51.4,"timestamp":965835,"blast_count":0}}

id: 31618d:69
event: packet
data: {"run_id":"31618d","seq":69,"t_ms":722227,"rssi":-72,"raw":"5e70edffff7640030103fd2903fe7d040000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16502,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"help","confidence":0.9922,"peak_level":809,"peak_db":80.9,"timestamp":294398,"blast_count":0}}

: ping

: ping

: ping

id: 31618d:70
event: packet
data: {"run_id":"31618d","seq":70,"t_ms":776266,"rssi":-65,"raw":"5e160bffffd566040103ff9b021ca80f0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26325,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":1.0,"peak_level":667,"peak_db":66.7,"timestamp":1026076,"blast_count":0}}

id: 31618d:71
event: packet
data: {"run_id":"31618d","seq":71,"t_ms":776556,"rssi":-67,"raw":"5e9a2dffff8849040103fffc028fa6000000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18824,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":1.0,"peak_level":764,"peak_db":76.4,"timestamp":42639,"blast_count":0}}

id: 31618d:72
event: packet
data: {"run_id":"31618d","seq":72,"t_ms":776621,"rssi":-66,"raw":"5e70edffff7740040103feb502de51050000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16503,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":0.9961,"peak_level":693,"peak_db":69.3,"timestamp":348638,"blast_count":0}}

id: 31618d:73
event: packet
data: {"run_id":"31618d","seq":73,"t_ms":789974,"rssi":-66,"raw":"5e9a2dffff8949040103ffbc020fdb000000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18825,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":1.0,"peak_level":700,"peak_db":70.0,"timestamp":56079,"blast_count":0}}

: ping

id: 31618d:74
event: packet
data: {"run_id":"31618d","seq":74,"t_ms":816039,"rssi":-59,"raw":"5e70edffff7840040103fc03028eec050000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16504,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":0.9882,"peak_level":515,"peak_db":51.5,"timestamp":388238,"blast_count":0}}

: ping

: ping

: ping

: ping

: ping

id: 31618d:75
event: packet
data: {"run_id":"31618d","seq":75,"t_ms":894156,"rssi":-51,"raw":"5e9a2dffff8a49040102fff602dd72020000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18826,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":758,"peak_db":75.8,"timestamp":160477,"blast_count":0}}

id: 31618d:76
event: packet
data: {"run_id":"31618d","seq":76,"t_ms":894211,"rssi":-67,"raw":"5e160bffffd666040102fdbd026d74110000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26326,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9922,"peak_level":701,"peak_db":70.1,"timestamp":1143917,"blast_count":0}}

id: 31618d:77
event: packet
data: {"run_id":"31618d","seq":77,"t_ms":894996,"rssi":-73,"raw":"5e70edffff7940040102eeb3021e1f070000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16505,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9333,"peak_level":691,"peak_db":69.1,"timestamp":466718,"blast_count":0}}

: ping

id: 31618d:78
event: packet
data: {"run_id":"31618d","seq":78,"t_ms":917826,"rssi":-69,"raw":"5e70edffff7a40030102ff18030f7a070000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16506,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":792,"peak_db":79.2,"timestamp":489999,"blast_count":0}}

id: 31618d:79
event: packet
data: {"run_id":"31618d","seq":79,"t_ms":918269,"rssi":-58,"raw":"5e9a2dffff8b49040102fff102aecf020000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18827,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":753,"peak_db":75.3,"timestamp":184238,"blast_count":0}}

id: 31618d:80
event: packet
data: {"run_id":"31618d","seq":80,"t_ms":918345,"rssi":-67,"raw":"5e160bffffd766040102ff76022fd2110000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26327,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":630,"peak_db":63.0,"timestamp":1167919,"blast_count":0}}

: ping

id: 31618d:81
event: packet
data: {"run_id":"31618d","seq":81,"t_ms":933812,"rssi":-67,"raw":"5e160bffffd866040102f676021e0f120000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26328,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9647,"peak_level":630,"peak_db":63.0,"timestamp":1183518,"blast_count":0}}

id: 31618d:82
event: packet
data: {"run_id":"31618d","seq":82,"t_ms":934169,"rssi":-66,"raw":"5e70edffff7b40040102fe4003dfb8070000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16507,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9961,"peak_level":832,"peak_db":83.2,"timestamp":506079,"blast_count":0}}

id: 31618d:83
event: packet
data: {"run_id":"31618d","seq":83,"t_ms":934369,"rssi":-59,"raw":"5e9a2dffff8c49040102ffd0027d0e030000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18828,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":720,"peak_db":72.0,"timestamp":200317,"blast_count":0}}

id: 31618d:84
event: packet
data: {"run_id":"31618d","seq":84,"t_ms":941919,"rssi":-60,"raw":"5e9a2dffff8d49040103f782036c2d030000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18829,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":0.9686,"peak_level":898,"peak_db":89.8,"timestamp":208236,"blast_count":0}}

id: 31618d:85
event: packet
data: {"run_id":"31618d","seq":85,"t_ms":954659,"rssi":-62,"raw":"5e9a2dffff8e49040102ff69031f5f030000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18830,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":873,"peak_db":87.3,"timestamp":220959,"blast_count":0}}

id: 31618d:86
event: packet
data: {"run_id":"31618d","seq":86,"t_ms":954787,"rssi":-66,"raw":"5e160bffffd966040102ec3902ad60120000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26329,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9255,"peak_level":569,"peak_db":56.9,"timestamp":1204397,"blast_count":0}}

id: 31618d:87
event: packet
data: {"run_id":"31618d","seq":87,"t_ms":955024,"rssi":-77,"raw":"5e70edffff7c40040102ff7c026f0a080000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16508,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":636,"peak_db":63.6,"timestamp":526959,"blast_count":0}}

: ping

: ping

id: 31618d:88
event: packet
data: {"run_id":"31618d","seq":88,"t_ms":993398,"rssi":-65,"raw":"5e9a2dffff8f49040102feeb0210f6030000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18831,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9961,"peak_level":747,"peak_db":74.7,"timestamp":259600,"blast_count":0}}

id: 31618d:89
event: packet
data: {"run_id":"31618d","seq":89,"t_ms":993607,"rssi":-71,"raw":"5e70edffff7d40040102ffaa0261a1080000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16509,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":682,"peak_db":68.2,"timestamp":565601,"blast_count":0}}

id: 31618d:90
event: packet
data: {"run_id":"31618d","seq":90,"t_ms":994169,"rssi":-65,"raw":"5e160bffffda66040102f53e027ef9120000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26330,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9608,"peak_level":574,"peak_db":57.4,"timestamp":1243518,"blast_count":0}}

: ping

id: 31618d:91
event: packet
data: {"run_id":"31618d","seq":91,"t_ms":1015368,"rssi":-59,"raw":"5e9a2dffff9049040102f793024c4c040000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18832,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9686,"peak_level":659,"peak_db":65.9,"timestamp":281676,"blast_count":0}}

id: 31618d:92
event: packet
data: {"run_id":"31618d","seq":92,"t_ms":1018732,"rssi":-56,"raw":"5e9a2dffff9149040102cdf5027b58040000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18833,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.8039,"peak_level":757,"peak_db":75.7,"timestamp":284795,"blast_count":0}}

: ping

id: 31618d:93
event: packet
data: {"run_id":"31618d","seq":93,"t_ms":1036823,"rssi":-70,"raw":"5e70edffff7e40040102bd19020e4b090000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16510,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.7412,"peak_level":537,"peak_db":53.7,"timestamp":609038,"blast_count":0}}

id: 31618d:94
event: packet
data: {"run_id":"31618d","seq":94,"t_ms":1039421,"rssi":-80,"raw":"5e9a2dffff9249040103fc8c021fa9040000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18834,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":0.9882,"peak_level":652,"peak_db":65.2,"timestamp":305439,"blast_count":0}}

id: 31618d:95
event: packet
data: {"run_id":"31618d","seq":95,"t_ms":1041428,"rssi":-69,"raw":"5e160bffffdb66030102f183024db0130000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26331,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"scream","confidence":0.9451,"peak_level":643,"peak_db":64.3,"timestamp":1290317,"blast_count":0}}

id: 31618d:96
event: packet
data: {"run_id":"31618d","seq":96,"t_ms":1042588,"rssi":-69,"raw":"5e70edffff7f40040102f9ba02af5f090000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16511,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9765,"peak_level":698,"peak_db":69.8,"timestamp":614319,"blast_count":0}}

id: 31618d:97
event: packet
data: {"run_id":"31618d","seq":97,"t_ms":1042596,"rssi":-66,"raw":"5e9a2dffff9349040102fed3024fb5040000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18835,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9961,"peak_level":723,"peak_db":72.3,"timestamp":308559,"blast_count":0}}

id: 31618d:98
event: packet
data: {"run_id":"31618d","seq":98,"t_ms":1042913,"rssi":-65,"raw":"5e160bffffdc66030102bd8202edb5130000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26332,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"scream","confidence":0.7412,"peak_level":642,"peak_db":64.2,"timestamp":1291757,"blast_count":0}}

: ping

id: 31618d:99
event: packet
data: {"run_id":"31618d","seq":99,"t_ms":1063889,"rssi":-66,"raw":"5e9a2dffff9449030102e0de02af09050000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18836,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"scream","confidence":0.8784,"peak_level":734,"peak_db":73.4,"timestamp":330159,"blast_count":0}}

id: 31618d:100
event: packet
data: {"run_id":"31618d","seq":100,"t_ms":1068093,"rssi":-68,"raw":"5e70edffff8040040102c5e101eec4090000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16512,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.7725,"peak_level":481,"peak_db":48.1,"timestamp":640238,"blast_count":0}}

id: 31618d:101
event: packet
data: {"run_id":"31618d","seq":101,"t_ms":1070818,"rssi":-59,"raw":"5e160bffffdd66040103f6a3026e26140000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26333,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":0.9647,"peak_level":675,"peak_db":67.5,"timestamp":1320558,"blast_count":0}}

id: 31618d:102
event: packet
data: {"run_id":"31618d","seq":102,"t_ms":1071565,"rssi":-64,"raw":"5e70edffff8140030102f0ca022fd0090000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16513,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"scream","confidence":0.9412,"peak_level":714,"peak_db":71.4,"timestamp":643119,"blast_count":0}}

id: 31618d:103
event: packet
data: {"run_id":"31618d","seq":103,"t_ms":1071618,"rssi":-69,"raw":"5e9a2dffff9549040102f2f902ce25050000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18837,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.949,"peak_level":761,"peak_db":76.1,"timestamp":337358,"blast_count":0}}

: ping

id: 31618d:104
event: packet
data: {"run_id":"31618d","seq":104,"t_ms":1090013,"rssi":-55,"raw":"5e9a2dffff9649040103fb3a02dd6f050000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18838,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":0.9843,"peak_level":570,"peak_db":57.0,"timestamp":356317,"blast_count":0}}

id: 31618d:105
event: packet
data: {"run_id":"31618d","seq":105,"t_ms":1100920,"rssi":-83,"raw":"5e70edffff8240040102daa1025f450a0000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16514,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.8549,"peak_level":673,"peak_db":67.3,"timestamp":673119,"blast_count":0}}

id: 31618d:106
event: packet
data: {"run_id":"31618d","seq":106,"t_ms":1101005,"rssi":-67,"raw":"5e9a2dffff9749040102ffde020d9a050000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18839,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":734,"peak_db":73.4,"timestamp":367117,"blast_count":0}}

id: 31618d:107
event: packet
data: {"run_id":"31618d","seq":107,"t_ms":1101275,"rssi":-69,"raw":"5e160bffffde66040102fa3302909c140000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26334,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9804,"peak_level":563,"peak_db":56.3,"timestamp":1350800,"blast_count":0}}

: ping

id: 31618d:108
event: packet
data: {"run_id":"31618d","seq":108,"t_ms":1123405,"rssi":-70,"raw":"5e9a2dffff9849030102fe17032ef2050000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18840,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"scream","confidence":0.9961,"peak_level":791,"peak_db":79.1,"timestamp":389678,"blast_count":0}}

id: 31618d:109
event: packet
data: {"run_id":"31618d","seq":109,"t_ms":1123728,"rssi":-65,"raw":"5e160bffffdf66040102ec5c02aef4140000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26335,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9255,"peak_level":604,"peak_db":60.4,"timestamp":1373358,"blast_count":0}}

id: 31618d:110
event: packet
data: {"run_id":"31618d","seq":110,"t_ms":1123755,"rssi":-78,"raw":"5e70edffff8340040102efa6026f9e0a0000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16515,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9373,"peak_level":678,"peak_db":67.8,"timestamp":695919,"blast_count":0}}

id: 31618d:111
event: packet
data: {"run_id":"31618d","seq":111,"t_ms":1137773,"rssi":-58,"raw":"5e9a2dffff9949040102da0e026e2a060000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18841,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.8549,"peak_level":526,"peak_db":52.6,"timestamp":404078,"blast_count":0}}

id: 31618d:112
event: packet
data: {"run_id":"31618d","seq":112,"t_ms":1146888,"rssi":-61,"raw":"5e9a2dffff9a49040102c106020e4e060000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18842,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.7569,"peak_level":518,"peak_db":51.8,"timestamp":413198,"blast_count":0}}

: ping

id: 31618d:113
event: packet
data: {"run_id":"31618d","seq":113,"t_ms":1163543,"rssi":-58,"raw":"5e9a2dffff9b49040103f8a102c18e060000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18843,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":0.9725,"peak_level":673,"peak_db":67.3,"timestamp":429761,"blast_count":0}}

id: 31618d:114
event: packet
data: {"run_id":"31618d","seq":114,"t_ms":1164704,"rssi":-60,"raw":"5e9a2dffff9c49040103ffa7026f93060000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18844,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":1.0,"peak_level":679,"peak_db":67.9,"timestamp":430959,"blast_count":0}}

: ping

: ping

: ping

id: 31618d:115
event: packet
data: {"run_id":"31618d","seq":115,"t_ms":1219106,"rssi":-78,"raw":"5e70edffff8440040101cd10029f120c0001","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":16516,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":0.8039,"peak_level":528,"peak_db":52.8,"timestamp":791199,"blast_count":1}}

: ping

id: 31618d:116
event: packet
data: {"run_id":"31618d","seq":116,"t_ms":1241931,"rssi":-61,"raw":"5e9a2dffff9d49040102d857024fc1070000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18845,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.8471,"peak_level":599,"peak_db":59.9,"timestamp":508239,"blast_count":0}}

id: 31618d:117
event: packet
data: {"run_id":"31618d","seq":117,"t_ms":1248713,"rssi":-53,"raw":"5e9a2dffff9e49030101ec3d0290db070001","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18846,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"whistle","confidence":0.9255,"peak_level":573,"peak_db":57.3,"timestamp":514960,"blast_count":1}}

: ping

: ping

: ping

id: 31618d:118
event: packet
data: {"run_id":"31618d","seq":118,"t_ms":1296655,"rssi":-61,"raw":"5e9a2dffff9f49040102f689020c97080000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18847,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9647,"peak_level":649,"peak_db":64.9,"timestamp":562956,"blast_count":0}}

: ping

: ping

: ping

: ping

: ping

id: 31618d:119
event: packet
data: {"run_id":"31618d","seq":119,"t_ms":1383387,"rssi":-78,"raw":"5e70edffff82f3040102f66702cede000000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":62338,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9647,"peak_level":615,"peak_db":61.5,"timestamp":57038,"blast_count":0}}

id: 31618d:120
event: packet
data: {"run_id":"31618d","seq":120,"t_ms":1383536,"rssi":-58,"raw":"5e160bffffe066030102fd2d02feeb180000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26336,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"scream","confidence":0.9922,"peak_level":557,"peak_db":55.7,"timestamp":1633278,"blast_count":0}}

id: 31618d:121
event: packet
data: {"run_id":"31618d","seq":121,"t_ms":1384617,"rssi":-78,"raw":"5e9a2dffffa049030102fe1c036fea090000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18848,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"scream","confidence":0.9961,"peak_level":796,"peak_db":79.6,"timestamp":649839,"blast_count":0}}

: ping

: ping

id: 31618d:122
event: packet
data: {"run_id":"31618d","seq":122,"t_ms":1428102,"rssi":-77,"raw":"5e160bffffe166040102fa4f025e9a190000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26337,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9804,"peak_level":591,"peak_db":59.1,"timestamp":1677918,"blast_count":0}}

id: 31618d:123
event: packet
data: {"run_id":"31618d","seq":123,"t_ms":1428549,"rssi":-78,"raw":"5e70edffff83f3040102ff6a02208e010000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":62339,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":618,"peak_db":61.8,"timestamp":101920,"blast_count":0}}

id: 31618d:124
event: packet
data: {"run_id":"31618d","seq":124,"t_ms":1428557,"rssi":-62,"raw":"5e9a2dffffa149040102ff7703d0980a0000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18849,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":887,"peak_db":88.7,"timestamp":694480,"blast_count":0}}

: ping

: ping

id: 31618d:125
event: packet
data: {"run_id":"31618d","seq":125,"t_ms":1469563,"rssi":-62,"raw":"5e9a2dffffa249040102ff8f020f3a0b0000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18850,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":655,"peak_db":65.5,"timestamp":735759,"blast_count":0}}

id: 31618d:126
event: packet
data: {"run_id":"31618d","seq":126,"t_ms":1469944,"rssi":-75,"raw":"5e160bffffe266040102ff28038f3c1a0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26338,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":808,"peak_db":80.8,"timestamp":1719439,"blast_count":0}}

: ping

id: 31618d:127
event: packet
data: {"run_id":"31618d","seq":127,"t_ms":1486929,"rssi":-53,"raw":"5e160bffffe366030102c9b2011c7f1a0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26339,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"scream","confidence":0.7882,"peak_level":434,"peak_db":43.4,"timestamp":1736476,"blast_count":0}}

: ping

: ping

: ping

: ping

id: 31618d:128
event: packet
data: {"run_id":"31618d","seq":128,"t_ms":1560305,"rssi":-72,"raw":"5e160bffffe466020102ff2403fd9d1b0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26340,"ttl":2,"hops":2,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":804,"peak_db":80.4,"timestamp":1809917,"blast_count":0}}

id: 31618d:129
event: packet
data: {"run_id":"31618d","seq":129,"t_ms":1560544,"rssi":-52,"raw":"5e9a2dffffa349040102ff04036f9c0c0000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18851,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":772,"peak_db":77.2,"timestamp":826479,"blast_count":0}}

id: 31618d:130
event: packet
data: {"run_id":"31618d","seq":130,"t_ms":1560752,"rssi":-54,"raw":"5e70edffff5b75030102ffbd02904c000000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":30043,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":701,"peak_db":70.1,"timestamp":19600,"blast_count":0}}

: ping

id: 31618d:131
event: packet
data: {"run_id":"31618d","seq":131,"t_ms":1577475,"rssi":-68,"raw":"5e160bffffe566040103f7cf017ee11b0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26341,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":0.9686,"peak_level":463,"peak_db":46.3,"timestamp":1827198,"blast_count":0}}

id: 31618d:132
event: packet
data: {"run_id":"31618d","seq":132,"t_ms":1582411,"rssi":-72,"raw":"5e160bffffe666040102ff44032ef51b0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26342,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":836,"peak_db":83.6,"timestamp":1832238,"blast_count":0}}

id: 31618d:133
event: packet
data: {"run_id":"31618d","seq":133,"t_ms":1582799,"rssi":-66,"raw":"5e9a2dffffa449040102fec2028ff40c0000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18852,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9961,"peak_level":706,"peak_db":70.6,"timestamp":849039,"blast_count":0}}

id: 31618d:134
event: packet
data: {"run_id":"31618d","seq":134,"t_ms":1582917,"rssi":-69,"raw":"5e70edffff5c75040102ffc902c0a3000000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":30044,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":713,"peak_db":71.3,"timestamp":41920,"blast_count":0}}

id: 31618d:135
event: packet
data: {"run_id":"31618d","seq":135,"t_ms":1596914,"rssi":-64,"raw":"5e160bffffe766040103fa25026c2d1c0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26343,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":0.9804,"peak_level":549,"peak_db":54.9,"timestamp":1846636,"blast_count":0}}

id: 31618d:136
event: packet
data: {"run_id":"31618d","seq":136,"t_ms":1606653,"rssi":-68,"raw":"5e160bffffe866040102ff5803dd531c0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26344,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":856,"peak_db":85.6,"timestamp":1856477,"blast_count":0}}

id: 31618d:137
event: packet
data: {"run_id":"31618d","seq":137,"t_ms":1606735,"rssi":-71,"raw":"5e9a2dffffa549040102ffba024e520d0000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18853,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":698,"peak_db":69.8,"timestamp":873038,"blast_count":0}}

id: 31618d:138
event: packet
data: {"run_id":"31618d","seq":138,"t_ms":1606992,"rssi":-73,"raw":"5e70edffff5d75040102ffb1026f02010000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":30045,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":1.0,"peak_level":689,"peak_db":68.9,"timestamp":66159,"blast_count":0}}

id: 31618d:139
event: packet
data: {"run_id":"31618d","seq":139,"t_ms":1619954,"rssi":-69,"raw":"5e160bffffe966040101b5da016e871c0002","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26345,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":0.7098,"peak_level":474,"peak_db":47.4,"timestamp":1869678,"blast_count":2}}

id: 31618d:140
event: packet
data: {"run_id":"31618d","seq":140,"t_ms":1624445,"rssi":-52,"raw":"5e9a2dffffa649040102c4eb01c0960d0000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18854,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.7686,"peak_level":491,"peak_db":49.1,"timestamp":890560,"blast_count":0}}

: ping

id: 31618d:141
event: packet
data: {"run_id":"31618d","seq":141,"t_ms":1643841,"rssi":-72,"raw":"5e70edffff5e75040101ffd802d192010003","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":30046,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":728,"peak_db":72.8,"timestamp":103121,"blast_count":3}}

id: 31618d:142
event: packet
data: {"run_id":"31618d","seq":142,"t_ms":1643924,"rssi":-59,"raw":"5e9a2dffffa749040101ffd5029ee30d0003","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18855,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":725,"peak_db":72.5,"timestamp":910238,"blast_count":3}}

id: 31618d:143
event: packet
data: {"run_id":"31618d","seq":143,"t_ms":1644074,"rssi":-76,"raw":"5e160bffffea66040101ffb1022ce51c0003","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26346,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":689,"peak_db":68.9,"timestamp":1893676,"blast_count":3}}

id: 31618d:144
event: packet
data: {"run_id":"31618d","seq":144,"t_ms":1649611,"rssi":-81,"raw":"5e9a2dffffa849030103fe50022ef90d0000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18856,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"help","confidence":0.9961,"peak_level":592,"peak_db":59.2,"timestamp":915758,"blast_count":0}}

id: 31618d:145
event: packet
data: {"run_id":"31618d","seq":145,"t_ms":1649972,"rssi":-77,"raw":"5e70edffff5f75040103fb320252a9010000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":30047,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":0.9843,"peak_level":562,"peak_db":56.2,"timestamp":108882,"blast_count":0}}

id: 31618d:146
event: packet
data: {"run_id":"31618d","seq":146,"t_ms":1650027,"rssi":-75,"raw":"5e160bffffeb66040103ffdf01aefb1c0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26347,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":1.0,"peak_level":479,"peak_db":47.9,"timestamp":1899438,"blast_count":0}}

id: 31618d:147
event: packet
data: {"run_id":"31618d","seq":147,"t_ms":1660872,"rssi":-79,"raw":"5e160bffffec66040101ff9302cd261d0001","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26348,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":659,"peak_db":65.9,"timestamp":1910477,"blast_count":1}}

id: 31618d:148
event: packet
data: {"run_id":"31618d","seq":148,"t_ms":1660888,"rssi":-59,"raw":"5e70edffff6075030101ffe90270d4010001","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":30048,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":745,"peak_db":74.5,"timestamp":119920,"blast_count":1}}

id: 31618d:149
event: packet
data: {"run_id":"31618d","seq":149,"t_ms":1661196,"rssi":-58,"raw":"5e9a2dffffa949040101ffd00240250e0002","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18857,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":720,"peak_db":72.0,"timestamp":927040,"blast_count":2}}

id: 31618d:150
event: packet
data: {"run_id":"31618d","seq":150,"t_ms":1668795,"rssi":-75,"raw":"5e70edffff6175040103fa180252f4010000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":30049,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":0.9804,"peak_level":536,"peak_db":53.6,"timestamp":128082,"blast_count":0}}

: ping

id: 31618d:151
event: packet
data: {"run_id":"31618d","seq":151,"t_ms":1696654,"rssi":-67,"raw":"5e160bffffed66040101ff15026eb31d0001","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26349,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":533,"peak_db":53.3,"timestamp":1946478,"blast_count":1}}

id: 31618d:152
event: packet
data: {"run_id":"31618d","seq":152,"t_ms":1697007,"rssi":-79,"raw":"5e70edffff6275040101ffef020162020002","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":30050,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":751,"peak_db":75.1,"timestamp":156161,"blast_count":2}}

id: 31618d:153
event: packet
data: {"run_id":"31618d","seq":153,"t_ms":1697431,"rssi":-73,"raw":"5e9a2dffffaa49030101ff0403dfb10e0001","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18858,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":772,"peak_db":77.2,"timestamp":963039,"blast_count":1}}

: ping

id: 31618d:154
event: packet
data: {"run_id":"31618d","seq":154,"t_ms":1725046,"rssi":-56,"raw":"5e9a2dffffab49040101b452027e200f0002","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18859,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":0.7059,"peak_level":594,"peak_db":59.4,"timestamp":991358,"blast_count":2}}

id: 31618d:155
event: packet
data: {"run_id":"31618d","seq":155,"t_ms":1730582,"rssi":-57,"raw":"5e9a2dffffac49040102c5410210360f0000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18860,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.7725,"peak_level":577,"peak_db":57.7,"timestamp":996880,"blast_count":0}}

id: 31618d:156
event: packet
data: {"run_id":"31618d","seq":156,"t_ms":1733662,"rssi":-83,"raw":"5e160bffffee66040101fffc01ce431e0001","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26350,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":508,"peak_db":50.8,"timestamp":1983438,"blast_count":1}}

id: 31618d:157
event: packet
data: {"run_id":"31618d","seq":157,"t_ms":1733948,"rssi":-62,"raw":"5e9a2dffffad49040101ffd3023e420f0001","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18861,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":723,"peak_db":72.3,"timestamp":999998,"blast_count":1}}

id: 31618d:158
event: packet
data: {"run_id":"31618d","seq":158,"t_ms":1734265,"rssi":-80,"raw":"5e70edffff6375040101ffdd0261f2020001","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":30051,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":733,"peak_db":73.3,"timestamp":193121,"blast_count":1}}

: ping

id: 31618d:159
event: packet
data: {"run_id":"31618d","seq":159,"t_ms":1754542,"rssi":-78,"raw":"5e160bffffef66030101ff88025d951e0001","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26351,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":648,"peak_db":64.8,"timestamp":2004317,"blast_count":1}}

id: 31618d:160
event: packet
data: {"run_id":"31618d","seq":160,"t_ms":1754844,"rssi":-72,"raw":"5e70edffff6475040101fffa02f343030001","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":30052,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":762,"peak_db":76.2,"timestamp":214003,"blast_count":1}}

id: 31618d:161
event: packet
data: {"run_id":"31618d","seq":161,"t_ms":1754977,"rssi":-62,"raw":"5e9a2dffffae49040101ffc202cf930f0002","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18862,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":706,"peak_db":70.6,"timestamp":1020879,"blast_count":2}}

: ping

: ping

id: 31618d:162
event: packet
data: {"run_id":"31618d","seq":162,"t_ms":1789855,"rssi":-67,"raw":"5e9a2dffffaf49040102ebe8029f1d100000","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18863,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9216,"peak_level":744,"peak_db":74.4,"timestamp":1056159,"blast_count":0}}

id: 31618d:163
event: packet
data: {"run_id":"31618d","seq":163,"t_ms":1790111,"rssi":-69,"raw":"5e70edffff6575040102fdda02c3cd030000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":30053,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9922,"peak_level":730,"peak_db":73.0,"timestamp":249283,"blast_count":0}}

id: 31618d:164
event: packet
data: {"run_id":"31618d","seq":164,"t_ms":1790314,"rssi":-69,"raw":"5e160bfffff066040102fd60021d201f0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26352,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"scream","confidence":0.9922,"peak_level":608,"peak_db":60.8,"timestamp":2039837,"blast_count":0}}

: ping

id: 31618d:165
event: packet
data: {"run_id":"31618d","seq":165,"t_ms":1811864,"rssi":-70,"raw":"5e160bfffff166040103ff10026f751f0000","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26353,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"help","confidence":1.0,"peak_level":528,"peak_db":52.8,"timestamp":2061679,"blast_count":0}}

id: 31618d:166
event: packet
data: {"run_id":"31618d","seq":166,"t_ms":1811899,"rssi":-57,"raw":"5e70edffff6675030103ff59021223040000","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":30054,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"help","confidence":1.0,"peak_level":601,"peak_db":60.1,"timestamp":271122,"blast_count":0}}

: ping

id: 31618d:167
event: packet
data: {"run_id":"31618d","seq":167,"t_ms":1840866,"rssi":-80,"raw":"5e70edffff6775040101ff9a028194040002","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":30055,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":666,"peak_db":66.6,"timestamp":300161,"blast_count":2}}

id: 31618d:168
event: packet
data: {"run_id":"31618d","seq":168,"t_ms":1841168,"rssi":-82,"raw":"5e160bfffff266030101ff4202dde61f0001","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26354,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":578,"peak_db":57.8,"timestamp":2090717,"blast_count":1}}

id: 31618d:169
event: packet
data: {"run_id":"31618d","seq":169,"t_ms":1841524,"rssi":-64,"raw":"5e9a2dffffb049040101fffc024fe5100002","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18864,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":764,"peak_db":76.4,"timestamp":1107279,"blast_count":2}}

id: 31618d:170
event: packet
data: {"run_id":"31618d","seq":170,"t_ms":1854405,"rssi":-58,"raw":"5e9a2dffffb149040101fff001ce19110001","magic":94,"src":11674,"node_id":11674,"node_hex":"0x2D9A","dst":65535,"msg_id":18865,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":496,"peak_db":49.6,"timestamp":1120718,"blast_count":1}}

id: 31618d:171
event: packet
data: {"run_id":"31618d","seq":171,"t_ms":1854767,"rssi":-78,"raw":"5e70edffff6875040101ffe101f2c9040002","magic":94,"src":60784,"node_id":60784,"node_hex":"0xED70","dst":65535,"msg_id":30056,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":1.0,"peak_level":481,"peak_db":48.1,"timestamp":313842,"blast_count":2}}

id: 31618d:172
event: packet
data: {"run_id":"31618d","seq":172,"t_ms":1855038,"rssi":-60,"raw":"5e160bfffff366030101fe9601501c200002","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":26355,"ttl":3,"hops":1,"type":"ALERT","alert":{"class":"whistle","confidence":0.9961,"peak_level":406,"peak_db":40.6,"timestamp":2104400,"blast_count":2}}

: ping
```

</details>
