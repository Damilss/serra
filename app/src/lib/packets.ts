// Serranet packets exactly as they go over the air, for the packet view.
// Layout: firmware/mesh/packet.h. Little-endian, like the firmware's packed structs.

import { CLS } from './alerts';
import { db, hex2, hex4, pad } from './format';
import { field } from './geo';
import type { AlertClass, Packet, PacketField } from './types';

export const MESH_MAGIC = 0x5e;
export const TTL_DEFAULT = 4;

const u16 = (v: number) => [v & 255, (v >> 8) & 255];
const i16 = (v: number) => u16(v & 0xffff); // signed 16-bit, two's complement
const u32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];

let packetSeq = 0;

export type PacketInput =
  | { kind: 'heartbeat'; msgId: number; hops: number }
  | {
      kind: 'alert';
      msgId: number;
      hops: number;
      conf: number;
      peak: number;
      uptime: number;
      cls: AlertClass;
    };

/**
 * Builds one advertisement field by field:
 *   AD header (length, 0xFF manufacturer data, company 0xFFFF)
 *   mesh_pkt_t header, 9 bytes: magic, src, dst, msg_id, ttl, type
 *   ALERT payload (alert_payload_t, 9 bytes): class_id, confidence, peak_level (i16), timestamp, blast_count
 *   or HEARTBEAT payload: battery and millivolts, a proposal until firmware defines it
 */
export function buildPacket(src: number, x: PacketInput, time = new Date()): Packet {
  const n = field(src);
  const ttl = TTL_DEFAULT - x.hops;
  const F = (name: string, bytes: number[], val: string, grp: PacketField['grp']): PacketField => ({
    name,
    bytes,
    val,
    grp,
  });
  const fields: PacketField[] = [
    F('AD len', [0], '', 'ad'),
    F('AD type', [0xff], 'manufacturer data', 'ad'),
    F('company', u16(0xffff), '0xFFFF (testing ID)', 'ad'),
    F('magic', [MESH_MAGIC], `0x${hex2(MESH_MAGIC)} · Serranet`, 'hdr'),
    F('src', u16(n.nodeId), `${hex4(n.nodeId)} · N${pad(n.num)} ${n.name}`, 'hdr'),
    F('dst', u16(0xffff), '0xFFFF · broadcast', 'hdr'),
    F('msg_id', u16(x.msgId), String(x.msgId), 'hdr'),
    F('ttl', [ttl], `${ttl} left · ${x.hops} hop${x.hops > 1 ? 's' : ''} used`, 'hdr'),
    F('type', [x.kind === 'alert' ? 1 : 2], x.kind === 'alert' ? 'ALERT' : 'HEARTBEAT', 'hdr'),
  ];
  if (x.kind === 'alert') {
    const c = Math.round(x.conf * 255);
    const cl = CLS[x.cls];
    // Whistles only (3 = distress pattern); the firmware sends 0 for SCREAM and HELP.
    // cl.bursts drives the waveform animation and is not this field.
    const blasts = x.cls === 'whistle' ? cl.bursts.length : 0;
    fields.push(
      F('class_id', [cl.id], cl.word.toUpperCase(), 'pl'),
      F('confidence', [c], `${c}/255 · ${x.conf.toFixed(2)}`, 'pl'),
      F('peak_level', i16(x.peak), `${x.peak} · ${db(x.peak)} dB`, 'pl'),
      F('timestamp', u32(x.uptime), `${(x.uptime / 1000).toFixed(1)} s uptime`, 'pl'),
      F('blast_count', [blasts], blasts ? `${blasts} · distress pattern` : '0 · not a whistle', 'pl'),
    );
  } else {
    const mv = Math.round(n.volts * 1000);
    fields.push(
      F('battery', [n.batt], `${n.batt}% (proposed)`, 'pl'),
      F('millivolts', u16(mv), `${mv} mV (proposed)`, 'pl'),
    );
  }
  const len = fields.slice(1).reduce((s, f) => s + f.bytes.length, 0);
  fields[0] = { ...fields[0], bytes: [len], val: `${len} bytes follow` };
  return { id: ++packetSeq, kind: x.kind, src, time, fields, size: len + 1 };
}

/** All bytes of a packet as space-separated hex. */
export const hexOf = (p: Packet) =>
  p.fields
    .flatMap((f) => f.bytes)
    .map(hex2)
    .join(' ');
