import { useEffect, useState } from 'react';

/**
 * DAR EKRAN KANCASI — Z3 (mobil düzen).
 *
 * Arayüz stilleri satır içi (inline) yazıldığı için CSS media query
 * kullanılamıyor: kırılım JS'ten okunur. `matchMedia` seçildi, `innerWidth`
 * değil — tarayıcı eşiği kendisi izler, her resize'da React state güncellemek
 * gerekmez (yalnız eşik geçilince bir kez render olur).
 *
 * EŞİK 1000 px: yan yana düzen 960 px sahne + 296 px efekt rafı + boşluk
 * ister (~1300 px). Eşik 720'de bırakılınca 900 px'lik pencerede sahne
 * 537 px'e düşüyordu — rafa yer açmak için görüntü feda ediliyordu. 1000
 * altında raf akışa girer (sahnenin ALTINA), sahne tam genişliği alır.
 */
export const DAR_ESIK = 1000;

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
