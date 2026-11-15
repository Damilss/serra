'use client';

// Replay scrubber under the map: play / pause, position, event marks and "Back to live".

import { DETECT } from '@/lib/alerts';
import { hms } from '@/lib/format';
import { NODES } from '@/lib/geo';
import { replayAlert, useDashboard } from '@/lib/store';

export function ReplayBar() {
  const replay = useDashboard((s) => s.replay);
  const a = useDashboard(replayAlert);
  const { toggleReplay, seekReplay, exitReplay } = useDashboard.getState();
  const playing = !!replay?.playing;

  return (
    <div className="replay">
      <button
        className="icon-btn"
        id="rp-play"
        aria-label={playing ? 'Pause replay' : 'Play replay'}
        onClick={toggleReplay}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" id="rp-icon">
          <path d={playing ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M6 4l14 8-14 8z'} />
        </svg>
      </button>
      <span className="label">Replay</span>
      <div className="track">
        <input
          type="range"
          id="rp-range"
          min="0"
          max={a ? a.dur.toFixed(2) : 5}
          step="0.01"
          value={replay?.e ?? 0}
          aria-label="Replay position"
          onChange={(e) => seekReplay(+e.target.value)}
        />
        <div className="marks" id="rp-marks">
          {a &&
            (
              [
                ['Call', 0],
                ['Classified', DETECT],
                ['At base', a.T],
              ] as const
            ).map(([l, v]) => (
              <span key={l} style={{ left: `${((v / a.dur) * 100).toFixed(1)}%` }}>
                {l}
              </span>
            ))}
        </div>
      </div>
      <span id="rp-time">t+{(replay?.e ?? 0).toFixed(1)} s</span>
      {a && (
        <>
          <button className="btn ghost" id="rp-exit" onClick={exitReplay}>
            Back to live
          </button>
          <span className="replay-title" id="rp-title">
            {NODES[a.src].name} · {hms(a.wall)}
          </span>
        </>
      )}
    </div>
  );
}
