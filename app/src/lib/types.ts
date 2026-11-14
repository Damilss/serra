// The dashboard's data contract. The mock feed produces these today; the live feed (Supabase,
// fed by the base-station decoder) will map its rows onto the same shapes.
// Wire format: firmware/mesh/packet.h. Database: app/supabase/migrations.

export type AlertClass = 'whistle' | 'scream' | 'help';
export type AlertStatus = 'incoming' | 'active' | 'ack' | 'resolved';

/** A point on the map, as fractions (0–1) of the ground area. */
export interface MapPoint {
  x: number;
  y: number;
}

export interface BaseStation extends MapPoint {
  kind: 'base';
  name: string;
  nodeId: number;
}

export interface Serranode extends MapPoint {
  kind: 'field';
  /** Display number: N01, N02, ... */
  num: number;
  name: string;
  /** u16 mesh ID (mesh_pkt_t.src), derived from the flash serial. */
  nodeId: number;
  /** Full flash serial, e.g. E6614C311B5A9F2D. */
  uid: string;
  /** Battery percentage, from HEARTBEAT (payload proposed, not defined by firmware yet). */
  batt: number;
  volts: number;
  /** Signal of the last packet the base heard from this node, dBm. */
  rssi: number;
}

export type MeshNode = BaseStation | Serranode;

/** One node's reading of a call. Matches a row of alert_readings. */
export interface Reading {
  /** Index into NODES. */
  i: number;
  /** Distance from the calling node, metres. */
  d: number;
  /** Seconds after the call until the sound reached this node (d / 343 m/s). */
  delay: number;
  /** peak_level as on the wire: calibrated level in tenths of a dB (853 = 85.3 dB). */
  peak: number;
}

/** One distress event. Matches a row of alerts (plus its readings). */
export interface Alert {
  id: number;
  /** Index into NODES of the node that heard it first and loudest. */
  src: number;
  cls: AlertClass;
  /** Seconds after the call until the relayed alert reaches each node (index = node). */
  arrival: number[];
  /** Seconds until it reaches the base. */
  T: number;
  /** Length of the replay, seconds. */
  dur: number;
  heard: Reading[];
  hops: number;
  /** Loudness-weighted fix and search radius in metres. */
  est: MapPoint & { r: number };
  /** Classifier confidence 0–1 (alert_payload_t.confidence / 255). */
  conf: number;
  /** performance.now() / 1000 when the call happened. */
  start: number;
  /** Wall-clock time of the call. */
  wall: Date;
  status: AlertStatus;
  note: string;
  latency: number;
  msgId: number;
  /** alert_payload_t.timestamp: the node's uptime in ms (not synced across nodes). */
  uptime: number;
}

export type FieldGroup = 'ad' | 'hdr' | 'pl';

/** One field of an advertisement: its bytes on the air and the decoded value. */
export interface PacketField {
  name: string;
  bytes: number[];
  val: string;
  grp: FieldGroup;
}

export interface Packet {
  id: number;
  kind: 'alert' | 'heartbeat';
  src: number;
  time: Date;
  fields: PacketField[];
  /** Advertising data length in bytes. */
  size: number;
}
