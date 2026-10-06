import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { hataGorunum, onbellekAnahtarlari, type HataGorunum } from './hataMesaji';
import { bosluk, kenarDurum, MONO, renk, SANS, yaricap, yazi, yuzey } from './tema';

/**
 * HATA SINIRI — render ağacı çökerse beyaz ekran yerine bu.
 *
 * NEDEN CLASS: `componentDidCatch` / `getDerivedStateFromError` yalnız class
 * bileşenlerinde var; React 19'da da hook karşılığı yok. Projedeki TEK class
 * bileşeni bu, sebebi burada yazılı.
 *
 * SINIRIN KAPSAMADIĞI: render DIŞINDA atılan hatalar (rAF döngüsü, olay
 * dinleyicisi, `await` içi). React onları görmez — bu yüzden `window`
 * üzerindeki `error` ve `unhandledrejection` olayları da dinlenir. Motor
 * döngüsündeki bir hata sahneyi dondurup arayüzü ayakta bırakıyordu; kullanıcı
 * "tıklıyorum bir şey olmuyor" diyordu, hiçbir yerde yazmıyordu.
 *
 * KURTARMA İKİ KADEMELİ:
 *  1. "yeniden dene" — sınır durumunu sıfırlar, ağaç yeniden mount edilir.
 *     Sayfa yenilenmez; motor yeniden kurulur, kullanıcının açık dosyası
 *     gider ama ayarlar/preset'ler localStorage'da kalır.
 *  2. "sayfayı yenile" — birinci kademe de çökerse.
 * Önbellek sınıfında üçüncü bir düğme çıkar (Cache Storage silme), çünkü o
 * hatada yenileme TEK BAŞINA işe yaramaz: bozuk dosya önbellekte durur.
 */
interface Durum {
  gorunum: HataGorunum | null;
  /** Kaçıncı kurtarma denemesi — key olarak verilir, ağaç gerçekten yeniden mount edilir. */
  nesil: number;
  temizleniyor: boolean;
}

export class HataSinir extends Component<{ children: ReactNode }, Durum> {
  state: Durum = { gorunum: null, nesil: 0, temizleniyor: false };

  static getDerivedStateFromError(hata: unknown): Partial<Durum> {
    return { gorunum: hataGorunum(hata) };
  }

  componentDidMount() {
    window.addEventListener('error', this.pencereHatasi);
    window.addEventListener('unhandledrejection', this.sozHatasi);
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.pencereHatasi);
    window.removeEventListener('unhandledrejection', this.sozHatasi);
  }

  componentDidCatch(hata: Error, bilgi: ErrorInfo) {
    // Konsol kaydı KORUNUR: sınır ekranı kullanıcı için, yığın izi geliştirici
    // için. Biri diğerinin yerini almaz.
    console.error('[HataSinir] render ağacı çöktü', hata, bilgi.componentStack);
  }

  /** Döngü/olay içindeki hatalar React'e uğramaz; buradan yakalanır. */
  private pencereHatasi = (olay: ErrorEvent) => {
    // Zaten bir hata gösteriliyorsa üstüne yazma — ilk hata asıl sebeptir,
    // sonrakiler genelde onun artçısı.
    if (this.state.gorunum) return;
    this.setState({ gorunum: hataGorunum(olay.error ?? olay.message) });
  };

  private sozHatasi = (olay: PromiseRejectionEvent) => {
    if (this.state.gorunum) return;
    this.setState({ gorunum: hataGorunum(olay.reason) });
  };

  private yenidenDene = () => {
    this.setState((s) => ({ gorunum: null, nesil: s.nesil + 1, temizleniyor: false }));
  };

  private onbellegiTemizle = async () => {
    this.setState({ temizleniyor: true });
    try {
      const hepsi = await caches.keys();
      await Promise.all(onbellekAnahtarlari(hepsi).map((ad) => caches.delete(ad)));
    } catch {
      // Silinemezse yenileme yine denenir; kullanıcı en kötü aynı ekrana döner.
    }
    location.reload();
  };

  render() {
    const g = this.state.gorunum;
    // Fragment + key: kurtarmada ağaç GERÇEKTEN yeniden mount edilir (aynı
    // key'le kalsaydı çöken bileşen kendi bozuk state'iyle geri gelirdi).
    // Sarmalayıcı bir <div> DEĞİL — App'in grid düzenine yeni bir kutu girmez.
    if (!g) return <Fragment key={this.state.nesil}>{this.props.children}</Fragment>;

    return (
      <div style={kaplama} role="alert">
        <div style={kutu}>
          <div style={{ display: 'flex', alignItems: 'center', gap: bosluk.s }}>
            <span style={nokta} />
            <strong style={{ fontSize: yazi.buyuk, letterSpacing: -0.2 }}>{g.baslik}</strong>
          </div>
          <p style={{ margin: 0, color: renk.metinSolgun, lineHeight: 1.55, fontSize: yazi.orta }}>
            {g.aciklama}
          </p>
          <ol style={liste}>
            {g.adimlar.map((a) => <li key={a}>{a}</li>)}
          </ol>
          <div style={{ display: 'flex', gap: bosluk.s, flexWrap: 'wrap' }}>
            <button type="button" style={birincil} onClick={this.yenidenDene}>yeniden dene</button>
            {g.onbellekTemizle && (
              <button type="button" style={ikincil} disabled={this.state.temizleniyor} onClick={this.onbellegiTemizle}>
                {this.state.temizleniyor ? 'temizleniyor…' : 'önbelleği temizle ve yenile'}
              </button>
            )}
            <button type="button" style={ikincil} onClick={() => location.reload()}>sayfayı yenile</button>
          </div>
          <details style={{ fontSize: yazi.kucuk, color: renk.metinSilik }}>
            <summary style={{ cursor: 'pointer', minHeight: 20 }}>hata metni</summary>
            <pre style={ham}>{g.ham}</pre>
          </details>
        </div>
      </div>
    );
  }
}

const kaplama = {
  position: 'fixed' as const,
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  padding: bosluk.l,
  background: renk.zemin,
  color: renk.metin,
  fontFamily: SANS,
  zIndex: 100,
  overflowY: 'auto' as const,
};

const kutu = {
  ...yuzey(1, yaricap.panel),
  width: 'min(520px, 100%)',
  boxSizing: 'border-box' as const,
  padding: bosluk.xl,
  display: 'grid',
  gap: bosluk.m,
};

/** Tek ışık kaynağı kuralı: durum rengi burada, düğmelerde değil. */
const nokta = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: renk.kotu,
  boxShadow: `0 0 10px ${renk.kotu}99`,
  flex: '0 0 auto',
};

const liste = {
  margin: 0,
  paddingLeft: 24,
  display: 'grid',
  gap: bosluk.xs,
  color: renk.metinSolgun,
  fontSize: yazi.govde,
  lineHeight: 1.5,
};

const birincil = {
  fontFamily: SANS,
  fontSize: yazi.orta,
  fontWeight: 600,
  minHeight: 36,
  padding: '8px 16px',
  borderRadius: yaricap.kontrol,
  borderWidth: 1,
  borderStyle: 'solid' as const,
  borderColor: kenarDurum.bilgi,
  background: renk.vurguSakin,
  color: '#dce9ff',
  cursor: 'pointer',
};

const ikincil = {
  fontFamily: SANS,
  fontSize: yazi.govde,
  minHeight: 36,
  padding: '8px 16px',
  borderRadius: yaricap.kontrol,
  borderWidth: 1,
  borderStyle: 'solid' as const,
  borderColor: renk.kenar,
  background: renk.yuzey2,
  color: renk.metin,
  cursor: 'pointer',
};

const ham = {
  margin: `${bosluk.xs}px 0 0`,
  padding: bosluk.s,
  ...yuzey(2, yaricap.kontrol),
  fontFamily: MONO,
  fontSize: yazi.kucuk,
  whiteSpace: 'pre-wrap' as const,
  overflowWrap: 'anywhere' as const,
  color: renk.metinSolgun,
};
