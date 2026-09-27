import { gaussianlariXyzw, gsGorunumIzdusumu } from './gsKamera.ts';
import type { Egitim } from '../engine/reconstruction/egitim3dgs.ts';
import { GORUNUR_ESIGI } from './splatSecim.ts';

/**
 * TEMİZLEME KAYNAĞI — aracın iki sahneye de bağlanmasını sağlayan ince katman.
 *
 * NEDEN: seçim mantığı (`splatSecim.ts`) yalnız bir xyzw dizisi ve bir
 * görünüm-izdüşüm matrisi ister; hangi sahneden geldiğini bilmez. İki sahne
 * ise ÇOK farklı:
 *
 *   MOTOR      — GaussianBuffer'ın CPU tarafı CANLI veridir, silme yerinde
 *                opaklık yazmaktır, geri alma bizim tuttuğumuz kayıttadır.
 *   3D EĞİTİM  — splat.js'in kendi tamponu; `gaussianlar()` KOPYA verir,
 *                silme `temizle()` ile GPU'ya yazılır, geri alma oturumun
 *                kendi jetonundadır ve TERS SIRADA çalışmak zorundadır.
 *
 * Ortak paydayı burada tanımlayıp aracı tek sürümde tutuyoruz. Aracın
 * kendisi hangi kaynakta olduğunu bilmez; yalnız `ad`ı ekranda gösterir.
 *
 * HER ŞEY ASENKRON: motor yolu aslında senkron ama arayüz tek olmalı, yoksa
 * araç iki ayrı akış taşır ve ikisi ayrı ayrı bozulur.
 */

export interface TemizlemeGeri {
  geriAl(): Promise<void>;
  /** Kaç splat silinmişti — şeritteki sayaç bunu yazar. */
  adet: number;
}

export interface TemizlemeKaynagi {
  /** Şeritte görünen kısa ad ("motor" / "3D eğitim"). */
  ad: string;
  /**
   * Seçim girdisi: stride-4 xyzw (opaklık 0..1). Motor yolunda bu CANLI
   * dizidir, eğitim yolunda bir KOPYA — araç ikisini de yalnız OKUR.
   */
  oku(): Promise<{ xyzw: Float32Array; count: number } | null>;
  /**
   * O anın görünüm-izdüşümü + izdüşümün piksel kadrajı. Kamera her karede
   * oynayabildiği için vurgu döngüsü bunu her karede çağırır; ucuz olmalı.
   */
  kare(): { vp: Float32Array; en: number; boy: number } | null;
  /** Çizimin kullandığı opaklık kapısı — seçimin "görünür" tanımı buna eşit. */
  esik(): number;
  /** Siler. `null` = silinecek bir şey yoktu (hepsi zaten ölüydü). */
  sil(indeksler: Int32Array): Promise<TemizlemeGeri | null>;
  /** Araç kapanırken çağrılır (önbellek bırakma). */
  birak?(): void;
}

/* ── MOTOR KAYNAĞI ───────────────────────────────────────────────────────── */

export interface MotorKancasi {
  gaussianSnapshot(): { a: Float32Array; count: number } | null;
  splatViewProjection(): Float32Array | null;
  commitSplatOpacity(): void;
  splatOpacityThreshold: number;
}

/**
 * Motorun GaussianBuffer'ı. Silme = opaklık 0 (diziden çıkarma DEĞİL; indeks
 * kaydırmak D.4 keyframe kimliğini ve sıralama scratch'ini geçersiz kılardı).
 */
export function motorKaynagi(
  engine: MotorKancasi,
  tuvalOlcusu: () => { en: number; boy: number },
): TemizlemeKaynagi {
  return {
    ad: 'motor',
    async oku() {
      const s = engine.gaussianSnapshot();
      return s ? { xyzw: s.a, count: s.count } : null;
    },
    kare() {
      const vp = engine.splatViewProjection();
      if (!vp) return null;
      const { en, boy } = tuvalOlcusu();
      return { vp, en, boy };
    },
    esik: () => engine.splatOpacityThreshold,
    async sil(indeksler) {
      const s = engine.gaussianSnapshot();
      if (!s) return null;
      const idx: number[] = [];
      const eski: number[] = [];
      for (const i of indeksler) {
        const o = i * 4 + 3;
        if (s.a[o] <= 0) continue;
        idx.push(i);
        eski.push(s.a[o]);
        s.a[o] = 0;
      }
      if (idx.length === 0) return null;
      engine.commitSplatOpacity();
      return {
        adet: idx.length,
        async geriAl() {
          const g = engine.gaussianSnapshot();
          if (!g) return;
          idx.forEach((i, n) => { g.a[i * 4 + 3] = eski[n]; });
          engine.commitSplatOpacity();
        },
      };
    },
  };
}

/* ── EĞİTİM KAYNAĞI ──────────────────────────────────────────────────────── */

/**
 * Eğitim oturumundaki splat'ların kapısı. Eğitici opaklığı LOGIT tutuyor ve
 * `temizle` ölüyü −20 yazıyor (alfa ≈ 2e-9). PLY dışa aktarımının kendi ölü
 * eşiği log(1/254) ≈ −5.54; arayüzün "görünür" tanımı onun ALTINDA kalmalı
 * ki araçta kaybolan bir splat çıktıda geri belirmesin.
 *
 * sigmoid(−5.54) ≈ 0.0039 olduğu için 0.004 seçildi: dışa aktarımın attığı
 * her şey araçta da ölü sayılır, canlı hiçbir splat yanlışlıkla elenmez.
 */
export const EGITIM_GORUNUR_ESIGI = 0.004;

/**
 * 3D eğitim oturumu. Üç zorunlu davranış, üçü de oturumun sözleşmesinden:
 *
 *  1. KOPYA ÖNBELLEĞE ALINIR. `gaussianlar()` her çağrıda GPU'dan geri okuma
 *     yapıyor; fırça her `pointermove`'da çağırsaydı araç kullanılamazdı.
 *     Önbellek silme sonrası YERİNDE güncellenir (silinenin opaklığı 0'a
 *     çekilir), böylece sayaç ve yeniden seçim doğru kalır.
 *  2. GERİ ALMA TERS SIRADA. Oturum ters sıra dışında reddediyor; araç zaten
 *     yığın olarak tutuyor, ama jeton `devamEt`/`kapat` sonrası geçersiz
 *     oluyor — o durumda hata YUTULMAZ, kullanıcıya söylenir.
 *  3. TEK İŞLEM. Oturum eşzamanlı çağrıyı reddediyor; her çağrı `await`
 *     edilir ve araç o sırada düğmeleri kilitler.
 */
export function egitimKaynagi(
  egitim: Pick<Egitim, 'gaussianlar' | 'temizle' | 'kamera'>,
): TemizlemeKaynagi {
  let onbellek: { xyzw: Float32Array; count: number } | null = null;
  return {
    ad: '3D eğitim',
    async oku() {
      if (onbellek) return onbellek;
      const g = await egitim.gaussianlar();
      onbellek = { xyzw: gaussianlariXyzw(g.data, g.n, g.stride), count: g.n };
      return onbellek;
    },
    kare() {
      const k = egitim.kamera;
      if (!k) return null;
      return { vp: gsGorunumIzdusumu(k), en: k.w, boy: k.h };
    },
    esik: () => EGITIM_GORUNUR_ESIGI,
    async sil(indeksler) {
      const secili = [...indeksler];
      if (secili.length === 0) return null;
      const geri = await egitim.temizle(secili);
      // Önbelleği yerinde güncelle: yeniden okumak bir GPU geri okuması daha
      // demek, oysa değişen tek şey bu indekslerin opaklığı.
      if (onbellek) for (const i of secili) onbellek.xyzw[i * 4 + 3] = 0;
      return {
        adet: secili.length,
        async geriAl() {
          await geri.geriAl();
          if (onbellek) onbellek = null; // gerçek opaklıklar oturumda; tazele
        },
      };
    },
    birak() { onbellek = null; },
  };
}

/** Motor yolunun varsayılan kapısı — kaynak verilmediği hâl için. */
export { GORUNUR_ESIGI };
