// SAM 2.1-tiny video ONNX grafiklerinin DIŞINDA kalan küçük ağırlıklar (JS'deki
// bellek bankası ister): bellek zamansal konum kodlaması (7×64), "bellek yok"
// gömmesi (256) ve nesne işaretçisi zamansal izdüşümü (64×256 + 64). Grafikleri
// yayımlayan depo (jax-image-tools/sam21-tiny-video-onnx) bunları taşımıyor;
// kaynak aynı temel model: facebook/sam2.1-hiera-tiny (Apache-2.0), SABİT
// revizyon. 156 MB safetensors yerine yalnız gereken baytlar HTTP Range ile
// alınır (68.608 bayt). Düzen (float32 LE, bu sırayla): SAM21_EKLER.
//   node scripts/sam21-ekler.mjs   → public/models/facebook/sam2.1-hiera-tiny/sam21-ekler.bin
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAM21_EKLER = {
  repo: 'facebook/sam2.1-hiera-tiny',
  rev: 'de431c4043854a71d8101e17995dfe596bf101a5',
  dosya: 'model.safetensors',
  dest: 'public/models/facebook/sam2.1-hiera-tiny/sam21-ekler.bin',
  tensorler: [
    'memory_temporal_positional_encoding', // [7,1,1,64]
    'no_memory_embedding', // [1,1,256]
    'temporal_positional_encoding_projection_layer.weight', // [64,256]
    'temporal_positional_encoding_projection_layer.bias', // [64]
  ],
  boyut: 68608,
  sha256: '1895b234c1e87b791d6df82f5ed98488107177c9f642d37c83237b276a0c444d',
};

async function aralik(url, bas, son) {
  const r = await fetch(url, { headers: { Range: `bytes=${bas}-${son}` } });
  if (r.status !== 206) throw new Error(`${url}: Range desteklenmedi (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

/** Gereken tensörleri indirir, tek tampon olarak döndürür (boyut + sha256 doğrulanır). */
export async function sam21Ekleri() {
  const e = SAM21_EKLER;
  const url = `https://huggingface.co/${e.repo}/resolve/${e.rev}/${e.dosya}`;
  const n = Number((await aralik(url, 0, 7)).readBigUInt64LE(0));
  const baslik = JSON.parse((await aralik(url, 8, 8 + n - 1)).toString('utf8'));
  const parcalar = [];
  for (const ad of e.tensorler) {
    const t = baslik[ad];
    if (!t || t.dtype !== 'F32') throw new Error(`${ad}: safetensors başlığında yok ya da F32 değil`);
    const [a, b] = t.data_offsets;
    parcalar.push(await aralik(url, 8 + n + a, 8 + n + b - 1));
  }
  const buf = Buffer.concat(parcalar);
  if (buf.length !== e.boyut) throw new Error(`sam21-ekler: beklenen ${e.boyut} bayt, gelen ${buf.length}`);
  const ozet = createHash('sha256').update(buf).digest('hex');
  if (e.sha256 && ozet !== e.sha256) throw new Error(`sam21-ekler: sha256 ${ozet} ≠ ${e.sha256}`);
  return { buf, ozet };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { buf, ozet } = await sam21Ekleri();
  await mkdir(dirname(SAM21_EKLER.dest), { recursive: true });
  await writeFile(SAM21_EKLER.dest, buf);
  console.log(`${SAM21_EKLER.dest}: ${buf.length} bayt, sha256 ${ozet}`);
}
