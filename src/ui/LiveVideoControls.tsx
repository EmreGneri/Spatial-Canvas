import { useEffect, useRef, useState } from 'react';
import type { LiveVideoStats } from './liveVideoStats';

export type { LiveVideoStats } from './liveVideoStats';

/** Controls the actual inference source, never a second decoder or capture map. */
export function LiveVideoControls({ video, stats, onError }: {
  video: HTMLVideoElement;
  stats: LiveVideoStats;
  onError: (message: string) => void;
}) {
  const preview = useRef<HTMLDivElement>(null);
  const [playback, setPlayback] = useState({ paused: video.paused, time: video.currentTime, duration: video.duration, rate: video.playbackRate });
  useEffect(() => {
    const host = preview.current!;
    const previousStyle = video.getAttribute('style');
    video.style.cssText = 'width:128px;height:88px;object-fit:contain;display:block;background:#000';
    host.appendChild(video);
    const update = () => setPlayback({ paused: video.paused, time: video.currentTime, duration: video.duration, rate: video.playbackRate });
    const events = ['timeupdate', 'durationchange', 'play', 'pause', 'seeked', 'loadedmetadata', 'ratechange'];
    events.forEach((event) => video.addEventListener(event, update));
    update();
    return () => {
      events.forEach((event) => video.removeEventListener(event, update));
      if (video.parentElement === host) host.removeChild(video);
      if (previousStyle === null) video.removeAttribute('style');
      else video.setAttribute('style', previousStyle);
    };
  }, [video]);
  const seekable = Number.isFinite(playback.duration) && playback.duration > 0;
  return (
    <section aria-label="Canlı video kontrolleri" style={{ width: 640, maxWidth: '100%', boxSizing: 'border-box', border: '1px solid #303d43', padding: 10, background: '#0c1114', display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: '#bacbd2' }}>
      <div ref={preview} aria-label="Kaynak video önizlemesi" />
      <div style={{ flex: '1 1 320px', display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => {
            if (video.paused) void video.play().catch((error) => onError(String(error)));
            else video.pause();
          }}>{playback.paused ? 'Oynat' : 'Duraklat'}</button>
          <label>Hız <select aria-label="Video oynatma hızı" value={playback.rate} onChange={(e) => {
            const rate = Number(e.target.value);
            setPlayback(previous => ({ ...previous, rate }));
            video.playbackRate = rate;
          }}>
            <option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1">1×</option>
          </select></label>
        </div>
        {seekable && <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input aria-label="Video zamanı" type="range" min={0} max={playback.duration} step={0.01} value={Math.min(playback.time, playback.duration)} style={{ flex: 1, minWidth: 80 }} onChange={(e) => {
            const time = Number(e.target.value);
            // Commit the controlled value before React restores it between native input/change events.
            setPlayback(previous => ({ ...previous, time }));
            video.currentTime = time;
          }} />
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{playback.time.toFixed(1)} / {playback.duration.toFixed(1)} sn</span>
        </label>}
        <output aria-label="Canlı derinlik ölçümü" style={{ fontVariantNumeric: 'tabular-nums', color: stats.path === 'depth' ? '#94d4bc' : '#e7be83' }}>
          {stats.path === 'depth'
            ? `${playback.paused ? 'Duraklatıldı' : `${stats.hz.toFixed(1)} derinlik/sn`} · ${Math.round(stats.inferenceMs)} ms${stats.geometryAgeMs === null ? '' : ` · 3D lag ${stats.geometryAgeMs} ms`} · ${stats.width}×${stats.height} · ${stats.frames} kare${stats.backend ? ` · ${stats.backend}` : ''}`
            : stats.path === 'loading' ? 'Derinlik modeli hazırlanıyor…' : 'Parlaklık yedeği — model derinliği kullanılamıyor'}
        </output>
        <span style={{ color: '#92a3ad' }}>Çizim FPS’si, derinlik güncelleme hızı değildir.</span>
      </div>
    </section>
  );
}
