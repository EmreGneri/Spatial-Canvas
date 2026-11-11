import { useEffect, useRef, useState } from 'react';
import type { LiveVideoStats } from './liveVideoStats';
import { dugme, renk, yaricap, yazi } from './tema';

export type { LiveVideoStats } from './liveVideoStats';

/** Controls the actual inference source, never a second decoder or capture map. */
export function LiveVideoControls({ video, stats, onError }: {
  video: HTMLVideoElement;
  stats: LiveVideoStats;
  onError: (message: string) => void;
}) {
  const preview = useRef<HTMLDivElement>(null);
  const [playback, setPlayback] = useState({ paused: video.paused, time: video.currentTime, duration: video.duration, rate: video.playbackRate, muted: video.muted });
  useEffect(() => {
    const host = preview.current!;
    const previousStyle = video.getAttribute('style');
    video.style.cssText = `width:48px;height:28px;object-fit:contain;display:block;background:#000;border-radius:${yaricap.kontrol}px`;
    host.appendChild(video);
    const update = () => setPlayback({ paused: video.paused, time: video.currentTime, duration: video.duration, rate: video.playbackRate, muted: video.muted });
    const events = ['timeupdate', 'durationchange', 'play', 'pause', 'seeked', 'loadedmetadata', 'ratechange', 'volumechange'];
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
  const tus = dugme(false);
  return (
    // Kutu yok: kaynak satırının altında kendi satırı, düğmeler diğerleriyle aynı boyda.
    <section aria-label="Canlı video kontrolleri" style={{ flexBasis: '100%', minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: yazi.kucuk, color: renk.metinSolgun }}>
      <div ref={preview} aria-label="Kaynak video önizlemesi" />
      <button style={tus} onClick={() => {
        if (video.paused) void video.play().catch((error) => onError(String(error)));
        else video.pause();
      }}>{playback.paused ? 'Oynat' : 'Duraklat'}</button>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Hız <select aria-label="Video oynatma hızı" value={playback.rate} style={{ ...tus, padding: '0 6px' }} onChange={(e) => {
        const rate = Number(e.target.value);
        setPlayback(previous => ({ ...previous, rate }));
        video.playbackRate = rate;
      }}>
        <option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1">1×</option>
      </select></label>
      {/* Kamera akışında ses izi yok (getUserMedia audio:false); düğme yalnız dosya videosunda. */}
      {!video.srcObject && <button style={tus} aria-pressed={!playback.muted} onClick={() => { video.muted = !video.muted; }}>
        {playback.muted ? 'Sesi aç' : 'Sesi kapat'}
      </button>}
      {seekable && <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input aria-label="Video zamanı" type="range" min={0} max={playback.duration} step={0.01} value={Math.min(playback.time, playback.duration)} style={{ width: 'clamp(80px, 14vw, 144px)' }} onChange={(e) => {
          const time = Number(e.target.value);
          // Commit the controlled value before React restores it between native input/change events.
          setPlayback(previous => ({ ...previous, time }));
          video.currentTime = time;
        }} />
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{playback.time.toFixed(1)} / {playback.duration.toFixed(1)} sn</span>
      </label>}
      <output aria-label="Canlı derinlik ölçümü" title="Çizim FPS’si, derinlik güncelleme hızı değildir." style={{ fontVariantNumeric: 'tabular-nums', color: stats.path === 'depth' ? renk.iyi : renk.uyari }}>
        {stats.path === 'depth'
          ? `${playback.paused ? 'Duraklatıldı' : `${stats.hz.toFixed(1)} derinlik/sn`} · ${Math.round(stats.inferenceMs)} ms${stats.geometryAgeMs === null ? '' : ` · 3D lag ${stats.geometryAgeMs} ms`} · ${stats.width}×${stats.height} · ${stats.frames} kare${stats.backend ? ` · ${stats.backend}` : ''}`
          : stats.path === 'loading' ? 'Derinlik modeli hazırlanıyor…' : 'Parlaklık yedeği — model derinliği kullanılamıyor'}
      </output>
    </section>
  );
}
