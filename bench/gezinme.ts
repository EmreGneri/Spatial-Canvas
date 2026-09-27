// GEZİNME ÖLÇÜMÜ — ince giriş. Bütün mantık `src/bench/gezinmeSayfasi.ts`'te
// (tsconfig yalnız `src`'yi denetler). `scripts/olc-gezinme.mjs` sürer;
// `bench/` üretim build'ine girmez.
import { gezinmeCalistir } from '../src/bench/gezinmeSayfasi.ts';

void gezinmeCalistir();
