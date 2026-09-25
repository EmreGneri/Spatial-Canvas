import { useEffect, useState } from 'react';

/**
 * DAR EKRAN KANCASI — Z3 (mobil düzen).
 *
 * Arayüz stilleri satır içi (inline) yazıldığı için CSS media query
 * kullanılamıyor: kırılım JS'ten okunur. `matchMedia` seçildi, `innerWidth`
 * değil — tarayıcı eşiği kendisi izler, her resize'da React state güncellemek
 * gerekmez (yalnız eşik geçilince bir kez render olur).
 *
 * EŞİK 720 px: masaüstü düzeni 640 px sahne + 220 px sabit sağ panel ister
 * (860 px). 720 altında sağ panel akışa girer, sahne kadraja sığar.
 */
export const DAR_ESIK = 720;

export function useDarEkran(esik = DAR_ESIK): boolean {
  const [dar, setDar] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(`(max-width: ${esik}px)`).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(max-width: ${esik}px)`);
    const degisti = (e: MediaQueryListEvent) => setDar(e.matches);
    setDar(mq.matches);
    mq.addEventListener('change', degisti);
    return () => mq.removeEventListener('change', degisti);
  }, [esik]);

  return dar;
}
