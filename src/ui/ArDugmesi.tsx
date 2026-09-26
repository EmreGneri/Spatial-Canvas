import { useEffect, useState, type CSSProperties } from 'react';
import { arDurum, guvensizBaglam, type ArDurum } from './arDurum';
import { bosluk, cam, dugme, renk, SANS, yaricap, yazi, yuzey } from './tema';

/**
 * AR/VR HIZLI ÖNİZLEME DÜĞMESİ.
 *
 * ÜÇ KADEMELİ AKIŞ (tek tıkla oturum açmıyor, bilerek):
 *  1. Düğme — cihazın GERÇEKTEN yapabileceğini yazar ("AR'da gör" /
 *     "başlıkta gör" / kapalı ve sebebi).
 *  2. Kısa tanıtım — oturum açılmadan ÖNCE ne olacağı: nasıl gezilir, hangi
 *     efektler kapalı, nasıl çıkılır. `requestSession` bir KULLANICI JESTİ
 *     ister; tanıtımdaki "başlat" o jesti taşır, yani ikinci tık bedava değil,
 *     tarayıcının şartı.
 *  3. Oturum — açılamazsa hata SATIRDA kalır, sessizce yutulmaz.
 *
 * Desteklenmeyen cihazda düğme GİZLENMEZ, kapalı ve sebepli durur: gizli
 * düğme "bu uygulamada AR yok" gibi okunur, oysa sorun cihazda.
 */
export function ArDugmesi({
  engine,
  sahneVar,
  say,
}: {
  engine: { xrOturumuAc(session: XRSession): Promise<void>; xrSunumda: boolean } | null;
  /** Gösterilecek bir sahne var mı. */
  sahneVar: boolean;
  say(m: string): void;
}) {
  const [durum, setDurum] = useState<ArDurum | null>(null);
  const [tanitim, setTanitim] = useState(false);
  const [aciliyor, setAciliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  // Destek sorgusu sahne durumu değişince tekrarlanır: "sahne yok" ile
  // "cihaz desteklemiyor" AYRI mesajlar, ikisi de doğru anda görünmeli.
  useEffect(() => {
    let iptal = false;
    const xr = navigator.xr;
    if (!xr) {
      setDurum(arDurum({ xrVar: false, arDestekli: null, vrDestekli: null, sahneVar, ua: navigator.userAgent }));
      return;
    }
    const sor = (kip: 'immersive-ar' | 'immersive-vr') =>
      xr.isSessionSupported(kip).catch(() => null);
    void Promise.all([sor('immersive-ar'), sor('immersive-vr')]).then(([ar, vr]) => {
      if (iptal) return;
      setDurum(arDurum({ xrVar: true, arDestekli: ar, vrDestekli: vr, sahneVar, ua: navigator.userAgent }));
    });
    return () => { iptal = true; };
  }, [sahneVar]);

  async function ac() {
    if (!engine || !durum?.kip) return;
    setAciliyor(true);
    setHata(null);
    try {
      const session = await navigator.xr!.requestSession(durum.kip, {
        // `local` her XR cihazında var; `local-floor` telefonda yok. Zorunlu
        // özelliği en aza indirmek "oturum açılamadı" hatasını önler.
        requiredFeatures: ['local'],
      });
      await engine.xrOturumuAc(session);
      setTanitim(false);
      say(`${durum.kip === 'immersive-ar' ? 'AR' : 'VR'} oturumu açıldı · post-efektler bu oturumda kapalı`);
      session.addEventListener('end', () => say('XR oturumu kapandı · sahne ekrana döndü'), { once: true });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setHata(m);
      say(`XR oturumu açılamadı: ${m}`);
    } finally {
      setAciliyor(false);
    }
  }

  if (!durum) return null;

  const guvensiz = guvensizBaglam(location.protocol, location.host);
  const kapali = !durum.acilabilir || !engine || guvensiz;

  return (
    // Tanıtım kartı düğmenin ÜSTÜNDE açılır; konumlandırma çıpası bu sarmalayıcı.
    // Şeridin kendisine `position: relative` vermek kartı şeridin tamamına
    // göre hizalardı ve dar pencerede kadraj dışına taşardı.
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        style={{ ...dugme(tanitim), opacity: kapali ? 0.5 : 1 }}
        aria-pressed={tanitim}
        title={guvensiz
          ? 'WebXR yalnız https (ve localhost) üzerinde açılır'
          : `${durum.baslik}${durum.acilabilir ? '' : ' — ayrıntı için tıkla'}`}
        onClick={() => setTanitim((v) => !v)}
      >
        ◈ {durum.etiket}
      </button>

      {tanitim && (
        <div style={sayfa} role="dialog" aria-label="AR önizleme">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: bosluk.s }}>
            <strong style={{ fontSize: yazi.baslik }}>{durum.etiket}</strong>
            <span style={{ fontSize: yazi.kucuk, color: renk.metinSilik }}>
              {durum.kip === 'immersive-ar' ? 'immersive-ar' : durum.kip === 'immersive-vr' ? 'immersive-vr' : 'desteklenmiyor'}
            </span>
          </div>

          <p style={{ margin: 0, color: renk.metinSolgun, fontSize: yazi.govde, lineHeight: 1.55 }}>
            {guvensiz ? 'WebXR yalnız güvenli bağlamda (https ya da localhost) açılır.' : durum.baslik}
          </p>

          <ol style={liste}>
            {(guvensiz
              ? ['Sayfayı https üzerinden aç.', 'Yerel geliştirmede localhost adresi de yeter.']
              : durum.adimlar).map((a) => <li key={a}>{a}</li>)}
          </ol>

          {hata && <div style={hataSatiri}>açılamadı: {hata}</div>}

          <div style={{ display: 'flex', gap: bosluk.s, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" style={dugme()} onClick={() => setTanitim(false)}>kapat</button>
            <button
              type="button"
              style={{ ...dugme(true), opacity: kapali || aciliyor ? 0.5 : 1 }}
              disabled={kapali || aciliyor}
              onClick={ac}
            >
              {aciliyor ? 'açılıyor…' : 'başlat'}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

const sayfa: CSSProperties = {
  position: 'absolute',
  right: bosluk.s,
  bottom: `calc(100% + ${bosluk.s}px)`,
  zIndex: 20,
  width: 'min(340px, calc(100vw - 32px))',
  boxSizing: 'border-box',
  ...cam({ blur: 24, radius: yaricap.panel }),
  padding: bosluk.l,
  display: 'grid',
  gap: bosluk.m,
  fontFamily: SANS,
};

const liste: CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  display: 'grid',
  gap: bosluk.xs,
  color: renk.metinSolgun,
  fontSize: yazi.govde,
  lineHeight: 1.5,
};

const hataSatiri: CSSProperties = {
  ...yuzey(2, yaricap.kontrol),
  padding: bosluk.s,
  borderColor: 'rgba(248,113,113,0.35)',
  color: renk.kotu,
  fontSize: yazi.kucuk,
};
