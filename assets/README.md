# assets

Test görselleri. Uygulama bunları kullanmaz — `public/` değildir, build'e girmez.

## thumbnail.jpg

`scripts/verify-curtain.mjs`'in varsayılan girdisi. Script bu dosya yoksa
atlanır; koyduğunuzda testi çalıştırır:

```
npm run verify
node scripts/verify-curtain.mjs                 # assets/thumbnail.jpg
node scripts/verify-curtain.mjs <fotoğraf yolu> # başka bir görsel
```

Nasıl bir görsel olmalı: **gerçek bir fotoğraf**, net bir öznesi (büst/portre)
ve ondan ayrışan bir arka planı olsun. Test RMBG maskesinin özneyi gerçekten
ayırdığını iddia ediyor — maskenin boş olmadığını ve tüm kareyi kaplamadığını
kontrol ediyor. Düz renk ya da sentetik bir görsel bu iddiaları geçemez.
