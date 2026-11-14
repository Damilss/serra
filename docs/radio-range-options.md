# Radio range: options for node-to-node links

**Status:** discussion. Nothing here is decided. This expands on [README decision 4](../README.md#4-networking-ble-flooding-not-wi-fi-soft-aps) and the "Range" item under [Known limitations](../README.md#known-limitations-and-open-questions).

**The question:** the onboard BLE radio reaches tens of meters per hop. For a wilderness search-and-rescue mesh, wouldn't a different RF link between nodes be better?

**Short answer:** for a real deployment, yes. That means a sub-GHz radio, most likely LoRa. For the hackathon, stay on BLE, mount the nodes higher, and write the mesh layer so the radio underneath can be swapped. The pitch should raise the range limit itself rather than wait for a judge to ask.

**About the numbers:** each figure has a numbered note pointing to its source; the notes are collected under [Sources](#sources). Figures marked *computed* are our own arithmetic from sourced inputs, with the working in the note. Figures marked *estimate* aren't from any datasheet.

## Contents

1. [BLE is already RF](#ble-is-already-rf)
2. [What the Pico 2 W gives us today](#what-the-pico-2-w-gives-us-today)
3. [Options](#options)
4. [Side by side](#side-by-side)
5. [If we move to LoRa: what changes](#if-we-move-to-lora-what-changes)
6. [Recommendation](#recommendation)
7. [Still to verify](#still-to-verify)
8. [Sources](#sources)

---

## BLE is already RF

BLE is a protocol that runs on a 2.4 GHz radio, so the choice isn't "BLE or RF". The choice is which radio and band carry the mesh: the CYW43439 already on the Pico 2 W, or a separate module wired to the RP2350 over SPI. Four things set how far one hop reaches:

- **Frequency.** For the same antenna gain, free-space path loss at 868 MHz is about 9 dB lower than at 2.44 GHz (*computed*)[^fspl]. Trees also absorb more at higher frequencies, though how much varies widely with species, density and water content[^p833].
- **Receiver sensitivity.** Slower data rates let a receiver pick out weaker signals. Most of LoRa's range comes from this: it trades speed for sensitivity.
- **Transmit power,** capped by the chip and by regional regulations.
- **Antenna and placement:** antenna gain, height above the ground, and line of sight.

Transmit power plus receiver sensitivity gives the **link budget**: the total signal loss a link can tolerate. In free space, every extra 6 dB of link budget doubles the range[^fspl]. Real terrain gives back less than that, but the ranking between options holds.

## What the Pico 2 W gives us today

From the CYW43439 datasheet[^cyw43439]:

| | Value | Where |
|---|---|---|
| BLE receive sensitivity | −97 dBm typical (GFSK, 1 Mbps) | Table 33 |
| BLE transmit power | 8.5 dBm typical; capped at 10 dBm at the antenna port | Table 33, note 36 |
| **Link budget** | **about 105 dB** at the chip, before board and antenna losses | *computed:* 8.5 + 97 |
| BLE scan current | 187 µA, scanning 11.25 ms out of every 1.28 s (under 1% of the time) | Table 39, note 53 |
| BLE non-connectable advertising, every 1 s | 93 µA | Table 39 |
| LE PHYs | Only 1 Mbps is specified. LE 2M, LE Coded (long range) and extended advertising aren't mentioned anywhere | Table 33, §6.1, §7.2 |

Caveats:

- The current figures are for very low duty cycles at VBAT = 3.6 V. A relay has to listen much more of the time to catch floods reliably, so the real draw will be higher. The RP2350 also has to keep waking to service the radio: our build uses the driver's polling mode, where radio work only happens when the runtime calls `cyw43_arch_poll()`[^cmake]. We need to measure this (see "Scan duty cycle vs. power" in [Known limitations](../README.md#known-limitations-and-open-questions)).
- The Pico 2 W's antenna is built into the board[^pico2w], and the board has no connector for an external one, so a better antenna isn't an option here. The datasheet also warns that metal near the antenna reduces its performance[^pico2w], which matters when we pick enclosures.

---

## Options

### 1. Stay on BLE (1 Mbps PHY): current plan

What's already in `firmware/CMakeLists.txt`: BTstack over the CYW43439, flooding with advertisements.

**Pros**
- No extra hardware; works on the boards we have.
- The Pi 5 hears it with its built-in Bluetooth ([decision 8](../README.md#8-raspberry-pi-5-as-the-base-station)), and a phone running nRF Connect can stand in as a node.
- An advertisement is about 0.4 ms on air per channel (*computed*)[^ble-airtime], so collisions are rare and a few ms of flooding jitter is enough.
- Low current when the scan duty cycle is low[^cyw43439].

**Cons**
- Tens of meters per hop. That's the README's estimate, and we haven't measured it yet.
- Covering real terrain would take a very large number of nodes.
- 2.4 GHz is shared with Wi-Fi and every other BLE device, which matters more at a hackathon venue than in the backcountry.
- Legacy advertisements cap a mesh packet at about 24 bytes ([payload budget](../README.md#payload-budget)). That's enough for alerts.

**Effort:** none.

### 2. BLE Long Range (LE Coded PHY)

Bluetooth 5's coded PHY trades data rate for sensitivity. TI puts it at about 2× the range of the 1 Mbps PHY at 500 kbps and nearly 4× at 125 kbps[^ti-coded]. In free space that's about 6 and 12 dB of extra link budget (*computed*)[^fspl]. It would run on the radio we already have.

**Pros**
- No new hardware, if the chip supports it.

**Cons**
- **Probably not supported.** The CYW43439 datasheet specifies only the 1 Mbps LE PHY, and the only Bluetooth 5 feature it names is LE Secure Connections[^cyw43439].
- Coded PHY advertising needs extended advertising, which the datasheet doesn't list either. It would also need BTstack support on the Pico.
- The base station would need it too. The Pi 5 has a different radio chip, which we haven't checked.
- It's still 2.4 GHz. Four times tens of meters is still not kilometers.

**Effort:** about an hour to settle. Send the HCI command *LE Read Local Supported Features* and check bit 8 (LE 2M PHY), bit 11 (LE Coded PHY) and bit 12 (LE Extended Advertising)[^le-bits]. Do it on both the Pico 2 W and the Pi 5.

### 3. Better placement (height and spacing)

Mount nodes 1.5–2 m up (tree trunk, pole, trekking-pole stake) instead of leaving them on the ground, and space them using measured range.

**Why it matters:** a radio link needs more than line of sight. It needs a clear zone around the straight line between the antennas (the first Fresnel zone), and at least 60% of that zone should be free of obstructions[^fresnel]. At 2.4 GHz over a 50 m hop, the zone is about 1.2 m in radius at the midpoint (*computed*)[^fresnel], so a node lying on the ground loses a large part of it to the earth.

**Pros**
- Free, and the same physics applies to every option. For LoRa over a 1 km hop the zone is about 9 m in radius (*computed*)[^fresnel], so height matters even more there.

**Cons**
- Helps, but doesn't change the order of magnitude.

**Effort:** one range-test session: one node advertising, a second node or a phone logging RSSI while walking away, on the ground and then at 1.5 m.

### 4. nRF24L01+ module (2.4 GHz)

Nordic's cheap 2.4 GHz packet radio on SPI. Versions with a power amplifier and low-noise amplifier (PA/LNA) add an external antenna.

| | Bare chip[^nrf-bare] | PA/LNA module (one vendor)[^nrf-pa] |
|---|---|---|
| Sensitivity | −94 dBm at 250 kbps | −94 dBm at 250 kbps |
| Transmit power | 0 dBm | +20 dBm |
| Link budget (*computed*) | 94 dB, *worse* than our onboard BLE | 114 dB |
| Receive current | 12.6–13.5 mA | about 45 mA |
| Range | not stated | about 1.1 km line of sight claimed; 300–500 m in practice per the vendor's FAQ |

**Pros**
- Cheap and simple; a PA/LNA module with a real antenna clearly beats the onboard BLE.

**Cons**
- **Same 2.4 GHz band,** so the same trouble with trees[^p833]. It doesn't fix the underlying problem.
- The bare module is worse than what we have; only the PA/LNA versions help.
- Listening costs 12.6–45 mA, far more than LoRa.
- A module and wiring per node, a new driver, and the base station needs one as well.

**Effort:** medium.

### 5. Sub-GHz FSK module (RFM69 / CC1101)

Simple packet radios at 433, 868 or 915 MHz. RFM69HCW figures: up to 100 mW (+20 dBm) transmit, up to 300 kbps, 16 mA receive[^rfm69]. Sensitivity is about −115 dBm (bit rate not stated); HopeRF's headline figure is −120 dBm at 1.2 kbps, but we haven't checked it[^rfm69-sens]. SparkFun reports "hundreds of meters" outdoors with few obstructions[^rfm69]. The CC1101 is a similar sub-GHz radio; we haven't pulled its numbers.

**Pros**
- Sub-GHz propagation, so it does better through trees than anything at 2.4 GHz[^p833].
- Much faster than LoRa, so packets are short on air and flooding is easier to tune.
- Simple drivers.

**Cons**
- Less range than LoRa: about 129–134 dB of link budget at 14 dBm (*computed*)[^rfm69-sens].
- 16 mA receive, about 3.5–4× an SX1262[^sx1262].
- Less precedent for this kind of mesh than LoRa.
- Same costs as LoRa: band choice by region, hardware per node, a new driver, a receiver at the base station.

**Effort:** medium to high, similar to LoRa.

### 6. LoRa module (SX1262 or SX1276): README's production path

Chirp spread spectrum at 433, 868 or 915 MHz. Meshtastic runs a flooding mesh much like ours on it[^meshtastic].

SX1262 figures from Semtech: up to +22 dBm transmit, sensitivity "down to −148 dBm" at its slowest settings, 4.2–4.6 mA receive (the product page gives both figures), and a 170 dB maximum link budget[^sx1262]. At the settings we'd likely use (125 kHz bandwidth), sensitivity at SF12 is about −133 to −137 dBm, and SF7 is roughly 12 dB worse (*estimate*)[^sx1262-sens]. Semtech's own range claim for LoRa in general is 3 miles (about 5 km) urban and 30 miles (about 48 km) outdoors[^sx1262]. Those are marketing figures, and real terrain will give much less.

At the EU limit of 14 dBm, that's a link budget of roughly **135–150 dB** (*computed*)[^sx1262-sens]. That's 30–45 dB more than our BLE, before the ~9 dB lower free-space loss at 868 MHz[^fspl] and the better penetration through trees[^p833].

**Pros**
- Kilometers per hop in open terrain[^sx1262].
- The cheapest listening of the add-on radios[^sx1262].
- Packets up to 255 bytes, so alerts can carry more.
- Proven for this pattern: Meshtastic floods with a hop limit, like we do[^meshtastic].

**Cons**
- **Slow.** A 24-byte mesh packet (our 9-byte header plus 15 bytes of payload) is on air for about 62 ms at SF7 and about 1.5 s at SF12 (*computed*)[^toa]. Flooding multiplies that: 10 nodes relaying one alert at SF12 is about 15 s of channel time.
- **Regulatory airtime limits.** In the EU, 868.0–868.6 MHz allows 25 mW e.r.p. at ≤1% duty cycle[^erc]. That's 36 s of transmitting per node per hour, or about 24 packets at SF12, relays and heartbeats included (*computed*)[^toa]. The 869.4–869.65 MHz sub-band allows 500 mW e.r.p. at ≤10%[^erc]. In the US, frequency-hopping systems with 125 kHz channels may occupy one channel for at most 0.4 s in any 20 s[^fcc], so a 1.5 s SF12 packet doesn't fit on one channel.
- **Hardware.** A module plus antenna per node, on SPI plus a few control pins. The base station needs a receiver too.
- **New dependency.** The Pico SDK has no LoRa driver, so it needs a design decision ([CONTRIBUTING](../CONTRIBUTING.md#build-on-the-pinned-pico-sdk)).

**Effort:** the highest of these options: modules, wiring, a driver, mesh timing changes and a new base-station receiver.

### 7. Hybrid: LoRa between nodes, BLE kept for nearby phones

LoRa carries the mesh. Each node still sends a slow BLE advertisement, so a rescuer's phone nearby can read the node directly (last alert, battery, node ID) without the base station.

**Pros**
- Long-range backbone, plus something useful for rescuers walking the area. Reuses the BLE work.

**Cons**
- Two radios to power and two stacks to keep running. The most complex option.

**Effort:** LoRa effort plus a little.

### Ruled out: Wi-Fi

Same band and antenna as BLE, so about the same range per hop, with more power and a fiddly soft-AP topology. See [decision 4](../README.md#4-networking-ble-flooding-not-wi-fi-soft-aps).

---

## Side by side

Link budgets assume 14 dBm transmit where regulations cap it (EU 868 MHz). Ranges are what the sources claim, not our measurements.

| Option | Band | Link budget | Receive current | Range per hop | Extra hardware | Effort |
|---|---|---|---|---|---|---|
| BLE 1 Mbps (today) | 2.4 GHz | ~105 dB[^cyw43439] | 187 µA at <1% scan[^cyw43439]; more for real relaying (to measure) | tens of m (README estimate) | none | none |
| BLE Coded PHY | 2.4 GHz | +6 to 12 dB over BLE[^ti-coded] | as above | 2–4× BLE[^ti-coded] | none | ~1 h check; likely unsupported |
| Better placement | any | — | — | real gain, same order of magnitude | stake or strap | one test session |
| nRF24L01+ PA/LNA | 2.4 GHz | ~114 dB[^nrf-pa] | ~45 mA[^nrf-pa] | 300–500 m line of sight in practice[^nrf-pa] | module + antenna | medium |
| RFM69HCW | sub-GHz | ~129–134 dB[^rfm69-sens] | 16 mA[^rfm69] | hundreds of m[^rfm69] | module + antenna | medium–high |
| LoRa (SX1262) | sub-GHz | ~135–150 dB[^sx1262-sens] | 4.2–4.6 mA[^sx1262] | kilometers[^sx1262] | module + antenna | high |

---

## If we move to LoRa: what changes

The README says the flooding logic "carries over almost unchanged". The logic does; some of the parameters and the setup around it don't.

- **Flooding jitter.** The few-ms random delay in the [flooding rules](../README.md#flooding-rules) works because a BLE advertisement is under 0.4 ms on air[^ble-airtime]. On LoRa the delay has to be on the order of one packet's airtime (tens of ms at SF7, more than a second at SF12)[^toa].
- **Rebroadcast suppression.** Meshtastic waits and listens before rebroadcasting, and skips its own rebroadcast if another node is already repeating the packet[^meshtastic]. That saves airtime on LoRa, and it would help on BLE too.
- **TTL and airtime budget.** Every node repeats every packet. Pick the TTL, heartbeat interval and spreading factor together so the network stays inside the regional airtime limit[^erc][^fcc].
- **Payload.** LoRa allows up to 255 bytes, so the 31-byte advertisement limit no longer applies. `mesh_pkt_t` can stay as it is.
- **Base station.** The Pi 5 needs a LoRa receiver: either an SX1262 HAT on its header, or a Pico 2 W with a LoRa module running our node firmware as a USB-serial gateway. The gateway reuses our firmware, and on the Pi `bleak` is replaced by a serial reader. [Decision 8](../README.md#8-raspberry-pi-5-as-the-base-station)'s "listens to the mesh directly with built-in Bluetooth" no longer holds.
- **Hardware.** Plug-on SX1262 boards for the Pico exist in 433, 868 and 915 MHz versions[^waveshare], which would avoid hand wiring. Check the board's pin use against the mic wiring.
- **Driver.** Options are Semtech's reference SX126x driver in C[^sx-driver], or RadioLib (C++). We didn't find a ready-made Pico SDK port of RadioLib, so we'd write its small hardware layer (SPI, GPIO, timing) ourselves[^radiolib]. Either is a new dependency and needs a decision.
- **Pins.** An SX1262 needs SPI (CS, CLK, MOSI, MISO) plus BUSY, DIO1 (interrupt) and RESET[^waveshare]: about 7 GPIOs, more if the board drives its antenna switch from a pin. The Pico 2 W's wireless chip uses GPIO 23, 24, 25 and 29, which aren't on the header[^pico2w], so there's no clash with the CYW43439. Hardware SPI also doesn't compete with the mic's PIO.
- **Radio power.** If nodes no longer need BLE, don't start BTstack, and the CYW43439 can stay powered down.
- **Regulation.** Modules are built for one band (433, 868 or 915 MHz)[^waveshare]. Buy for the region the system will run in, and check local rules before quoting numbers[^erc][^fcc].

---

## Recommendation

**For the hackathon**

1. Keep BLE at 1 Mbps.
2. Write `firmware/mesh/` against a small radio interface so the mesh code never touches advertisements directly. Moving to LoRa then means writing one new backend, not reworking the mesh. A sketch:

   ```c
   // firmware/mesh/radio.h (sketch)
   typedef void (*radio_rx_cb)(const uint8_t *buf, size_t len, int8_t rssi);

   typedef struct {
       size_t   max_packet;     // ~24 bytes for a legacy BLE advertisement, 255 for LoRa
       uint32_t jitter_max_ms;  // scale with airtime: a few ms on BLE, seconds on LoRa SF12
   } radio_caps_t;

   const radio_caps_t *radio_caps(void);
   bool radio_send(const uint8_t *buf, size_t len);
   void radio_set_rx_callback(radio_rx_cb cb);
   ```

3. Mount nodes off the ground in the demo, and run one range test beforehand so the slides carry a measured number instead of "tens of meters".
4. Spend an hour checking for LE Coded PHY. If it's there, it's a free 2–4×, but don't count on it.

**For the pitch:** raise the range limit before anyone asks, give one number for today and one for deployment, and show that only the bottom layer changes. The demo already turns transmit power down to force multi-hop in one room ([Demo](../README.md#demo)). That makes it a scale model of a LoRa mesh across a valley, which is a good way to say it.

**For deployment:** LoRa (SX1262) on the region's band, recorded as a new design decision that updates decision 4.

---

## Still to verify

- [ ] Measured BLE range between two Pico 2 Ws: on the ground vs. 1.5 m up, indoors and outdoors.
- [ ] Node current while scanning at a duty cycle that relays reliably, RP2350 included.
- [ ] LE feature bits (2M, Coded, extended advertising) on the Pico 2 W and the Pi 5.
- [ ] Which region's band the pitch quotes (EU 868 or US 915), and that region's current rules.
- [ ] SX1262 sensitivity at the spreading factor we'd use, from Semtech's official datasheet (we only saw a third-party copy).
- [ ] RFM69HCW sensitivity at a realistic bit rate, from HopeRF's datasheet.
- [ ] Lead time for LoRa modules, and whether a plug-on Pico board fits with our mic wiring.

---

## Sources

Notes are numbered in order of first use. *Computed* means our own arithmetic, with the working shown; *estimate* means not taken from a datasheet.

[^fspl]: Free-space path loss grows as 20·log10 of both distance and frequency ([Wikipedia: Free-space path loss](https://en.wikipedia.org/wiki/Free-space_path_loss)). *Computed:* 20·log10(2440 / 868) ≈ 9.0 dB. Doubling the distance adds 20·log10(2) ≈ 6 dB, so 6 dB of extra budget doubles free-space range; 2× and 4× range correspond to 6 and 12 dB.

[^p833]: ITU-R Recommendation [P.833-10](https://www.itu.int/dms_pubrec/itu-r/rec/p/R-REC-P.833-10-202109-I!!PDF-E.pdf) (2021), *Attenuation in vegetation*. Attenuation through woodland generally rises with frequency, and varies widely with species, density and water content.

[^cyw43439]: Infineon, *CYW43439 datasheet*, document 002-30348 Rev. \*B: §6.1 and §7.2 (Bluetooth features), Table 33 (BLE RF specifications), Table 39 (Bluetooth current consumption, VBAT = 3.6 V, WLAN in reset). [Copy read for this doc](https://hestore.eu/prod_getfile.php?id=14404) · [Farnell copy](https://www.farnell.com/datasheets/3758304.pdf) · [Infineon product page](https://www.infineon.com/cms/en/product/wireless-connectivity/airoc-wi-fi-plus-bluetooth-combos/cyw43439/).

[^cmake]: [`firmware/CMakeLists.txt`](../firmware/CMakeLists.txt): links `pico_cyw43_arch_poll`, commented "work happens only when the runtime calls cyw43_arch_poll()".

[^pico2w]: Raspberry Pi, *Pico 2 W datasheet*, in this repo at [`docs/refs/firmware/RP-008304-DS-3-pico-2-w-datasheet.pdf`](refs/firmware/RP-008304-DS-3-pico-2-w-datasheet.pdf). "About Pico 2 W": onboard antenna licensed from Abracon. Pin list for internal board functions: GPIO 23, 24, 25 and 29 drive the wireless interface. "Applications information": metal under or close to the antenna reduces its performance.

[^ble-airtime]: *Computed:* a legacy advertising packet with 31 bytes of data is 47 bytes on air (1 preamble + 4 access address + 2 header + 6 advertiser address + 31 data + 3 CRC). At 1 Mbps, that's 376 µs per channel.

[^ti-coded]: Texas Instruments, SimpleLink BLE5 stack user guide, [LE Coded PHY](https://software-dl.ti.com/lprf/simplelink_cc26x2_latest/docs/ble5stack/ble_user_guide/html/ble-stack-5.x/phy-coded.html).

[^le-bits]: Bluetooth Core Specification, Vol 6, Part B, §4.6 (feature support). Cross-checked against [TI's HCI extension documentation](https://dev.ti.com/tirex/explore/content/CC33XX_LINUX_MPU_1_00_00_09__all/docs/linux/html/vs-hci-commands/hci_ext_api.html), which gives the same features as bit masks 0x100, 0x800 and 0x1000.

[^fresnel]: First Fresnel zone radius at the midpoint: F1 = 8.66·√(D / f) m, with D in km and f in GHz; keep at least 60% of it clear ([Omni Calculator: Fresnel zone](https://www.omnicalculator.com/physics/fresnel-zone), [RF Cafe: Fresnel zone](https://rfcafe.com/references/electrical/fresnel-zone.htm)). *Computed:* 50 m at 2.44 GHz gives 1.24 m; 1 km at 0.868 GHz gives 9.3 m.

[^nrf-bare]: Nordic nRF24L01+ (bare chip), [DigiKey listing](https://www.digikey.com/en/products/detail/nordic-semiconductor-asa/NRF24L01P-R/4691696): 0 dBm output, −94 dBm sensitivity, 12.6–13.5 mA receive. The −94 dBm figure is for the 250 kbps mode ([Microwaves & RF](https://www.mwrf.com/markets/article/21842904/24ghz-transceiver-delivers-lean-power-solution)). *Computed:* 0 + 94 = 94 dB.

[^nrf-pa]: ShillehTek, [nRF24L01+ PA/LNA module manual](https://shillehtek.com/blogs/shillehtek-product-manuals/nrf24l01-pa-lna-wireless-transceiver-module-antenna-1100m-range-manual): +20 dBm max, −94 dBm at 250 kbps, about 45 mA receive, about 115 mA transmit, about 1,100 m line of sight claimed; its FAQ says 300–500 m in practice. *Computed:* 20 + 94 = 114 dB.

[^rfm69]: SparkFun, [RFM69HCW hookup guide](https://learn.sparkfun.com/tutorials/rfm69hcw-hookup-guide/hardware-overview): up to 100 mW, up to 300 kbps, 16 mA in receive, "hundreds of meters" outdoors with few obstructions.

[^rfm69-sens]: done.land, [RFM69 page](https://done.land/components/data/datatransmission/wireless/shortrangedevice/fm/gfsk/transceiver/rfm69): −115 dBm (bit rate not stated). HopeRF's datasheet headline of −120 dBm at 1.2 kbps was not checked for this doc. *Computed:* 14 + 115 to 14 + 120 = 129–134 dB.

[^sx1262]: Semtech, [SX1262 product page](https://www.semtech.com/products/wireless-rf/lora-connect/sx1262): up to +22 dBm, sensitivity "down to −148 dBm", 4.2 mA receive (overview) or 4.6 mA (feature list), 170 dB maximum link budget. For LoRa in general: "a 3-mile range in urban environments and a 30-mile range outdoors".

[^sx1262-sens]: SF12 at 125 kHz: −133 dBm in a [third-party copy of Semtech's SX1261/2 datasheet](https://www.scribd.com/document/448963424/DS-SX1261-2-V1-2) (v1.2), and −136.7 dBm claimed for [Seeed's Wio-SX1262 module](https://www.mouser.lt/pdfDocs/Wio-SX1262module-Datasheet.pdf), line loss included. *Estimate:* SF7 is about 12 dB less sensitive, assuming roughly 2.5 dB per spreading-factor step. *Computed:* 14 dBm transmit + 121–137 dB sensitivity ≈ 135–151 dB.

[^meshtastic]: Meshtastic blog, [Why Meshtastic uses managed flood routing](https://meshtastic.org/blog/why-meshtastic-uses-managed-flood-routing/): packets are rebroadcast "up to a defined hop limit", and "before a node rebroadcasts, it waits a short while and listens if anyone else is already rebroadcasting. If so, it will not rebroadcast again."

[^toa]: LoRa time-on-air formula from Semtech AN1200.13, as reproduced by [this calculator](https://embedwise.pages.dev/calculators/lora-time-on-air). *Computed* for a 24-byte packet at 125 kHz, coding rate 4/5, 8-symbol preamble, explicit header and CRC on, with low-data-rate optimization at SF12: SF7 ≈ 61.7 ms, SF12 ≈ 1,483 ms. Then 10 relays × 1.48 s ≈ 15 s, and 36 s ÷ 1.48 s ≈ 24 packets per hour.

[^erc]: CEPT [ERC/DEC/(01)04](https://docdb.cept.org/download/2369) and ERC Recommendation 70-03, Annex 1. 868.0–868.6 MHz: 25 mW e.r.p., ≤1% duty cycle or listen-before-talk with adaptive frequency agility. 869.4–869.65 MHz: 500 mW e.r.p., ≤10% duty cycle or the same alternative. Check the current REC 70-03 and national rules before quoting.

[^fcc]: 47 CFR §15.247(a)(1)(i) ([eCFR](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-A/part-15/subpart-C/subject-group-ECFR2f2e5828339709e/section-15.247), [Cornell LII](https://www.law.cornell.edu/cfr/text/47/15.247)): in 902–928 MHz, frequency-hopping systems with a 20 dB bandwidth under 250 kHz need at least 50 channels and may occupy any one channel for at most 0.4 s in 20 s.

[^waveshare]: Waveshare, [Pico-LoRa-SX1262](https://www.waveshare.com/pico-lora-sx1262-868m.htm): an SX1262 board that plugs onto a Pico's header, sold in 433, 868 and 915 MHz versions, on SPI. An [SX1262 HAT user guide](https://cdn.shopify.com/s/files/1/0252/6615/9704/files/SX1262_915M_LoRa_HAT_User_Guide.pdf) for full-size Pis lists the radio's signals: CS, CLK, MOSI, MISO, BUSY, DIO1, DIO4, RST.

[^sx-driver]: Semtech, [Lora-net/sx126x_driver](https://github.com/Lora-net/sx126x_driver): reference C driver for the SX126x family, BSD-3-Clause-Clear licensed.

[^radiolib]: RadioLib's [non-Arduino ESP-IDF example](https://components.espressif.com/components/jgromes/radiolib/versions/8.0.0/examples/NonArduino/ESP-IDF) shows the hardware layer a port provides (SPI, GPIO, timing). We didn't find a ready-made Pico SDK port.
