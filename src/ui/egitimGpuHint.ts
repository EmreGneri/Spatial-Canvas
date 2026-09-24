export function egitimGpuHint(gpuName: string, integrated: boolean, userAgent: string): string | null {
  if (!integrated) return null;
  const introduction = `WebGPU ${gpuName} entegre Intel GPU'sunu seçti; eğitim hafif ayarla çalışıyor.`;
  if (!/Windows/i.test(userAgent)) {
    return `${introduction} Ayrı ekran kartınız varsa sistemin grafik ayarlarından tarayıcı için onu seçin.`;
  }
  return `${introduction} Ayrı ekran kartınız varsa Windows Ayarlar > Sistem > Ekran > Grafik bölümünde ` +
    'tarayıcıyı seçin, Seçenekler > Yüksek performans > Kaydet yolunu izleyin; ' +
    'tarayıcıyı tamamen kapatıp yeniden açın ve eğitimi başlatın.';
}
