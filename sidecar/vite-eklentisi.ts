// `npm run dev` yerel yardımcıyı (sidecar/server.py) kendisi başlatır ve kapanınca durdurur.
// Kurulu değilse (sanal ortam ya da modeller eksik) tek satır ipucu yazar; dev normal sürer.
// Ölçüm araçları SIDECAR_OTOMATIK=0 verir (scripts/tarayici-oturumu.mjs): ölçümler tekrarlanabilir kalsın.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

const KOK = import.meta.dirname;

async function calisiyorMu(): Promise<boolean> {
  try {
    const r = await fetch('http://127.0.0.1:8765/health', { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}

// Windows'ta .venv\Scripts\python.exe bir BAŞLATICI: asıl yorumlayıcıyı alt süreç olarak
// açar. Yalnız başlatıcıyı öldürmek sunucuyu yetim bırakıyordu (ölçüldü); ağaç kapatılır.
function agaciOldur(cocuk: ChildProcess | null | undefined) {
  if (!cocuk?.pid || cocuk.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(cocuk.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    cocuk.kill();
  }
}

// Vite config değişince sunucu yeniden başlar ve bu modül YENİDEN yüklenir; süreç
// referansı modülde tutulsaydı eski sunucu yardımcıyı öldürür, yenisi onu "zaten
// çalışıyor" sanıp başlatmazdı (ölçüldü: yeniden başlatmadan sonra yardımcı yok).
// Bu yüzden süreç globalThis'te durur ve yalnız Node süreci biterken öldürülür.
const g = globalThis as { __scYardimci?: ChildProcess | null; __scCikisKanca?: boolean };

export function yardimciEklentisi(): Plugin {
  return {
    name: 'spatial-canvas-yardimci',
    apply: 'serve',
    async configureServer(server) {
      if (process.env.SIDECAR_OTOMATIK === '0') return;
      const log = server.config.logger;
      if (g.__scYardimci && g.__scYardimci.exitCode === null) return; // önceki başlatmadan sürüyor
      const python = resolve(KOK, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      if (!existsSync(python) || !existsSync(resolve(KOK, 'models', 'da3mono_large.onnx'))) {
        log.info('[yardımcı] kurulu değil, tarayıcı modelleri kullanılacak. Kurulum: python sidecar/hazirla.py');
        return;
      }
      if (await calisiyorMu()) {
        log.info('[yardımcı] zaten çalışıyor (127.0.0.1:8765)');
        return;
      }
      // AYRIK başlatılır: terminal konsoluna bağlı kalırsa, terminal penceresi ön planda
      // değilken Windows süreç ağacını kısıyor (ölçüldü: 12–14 sn/istek; ayrık 0,26 sn).
      // Ayrık süreç Ctrl-C almaz; --ebeveyn ile bu Node süreci bitince kendini kapatır.
      const cocuk = spawn(python, [resolve(KOK, 'server.py'), '--ebeveyn', String(process.pid)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        detached: true,
        windowsHide: true,
      });
      g.__scYardimci = cocuk;
      const satirlar = (yaz: (m: string) => void) => (veri: Buffer) => {
        for (const satir of veri.toString('utf8').split(/\r?\n/)) if (satir.trim()) yaz(`[yardımcı] ${satir}`);
      };
      cocuk.stdout?.on('data', satirlar((m) => log.info(m)));
      cocuk.stderr?.on('data', satirlar((m) => log.warn(m)));
      cocuk.on('exit', (kod) => {
        if (kod === 3) log.info('[yardımcı] başka bir örnek zaten çalışıyor; o kullanılacak');
        else if (kod) log.warn(`[yardımcı] durdu (çıkış ${kod}); tarayıcı modelleri kullanılacak`);
        if (g.__scYardimci === cocuk) g.__scYardimci = null;
      });
      log.info('[yardımcı] başlatılıyor (modeller ~15 sn içinde hazır)…');
      if (!g.__scCikisKanca) {
        g.__scCikisKanca = true;
        process.once('exit', () => agaciOldur(g.__scYardimci));
      }
    },
  };
}
