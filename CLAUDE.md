# Mafia — onlayn o'yin

Node.js + Express + Socket.IO. O'yin mantig'i `game.js` faylida, server `server.js` faylida, brauzer qismi `public/` papkasida.
Ishga tushirish: `npm start`. Botlar bilan test: `npm test`.

## Tillar (muhim)
- Barcha foydalanuvchiga ko'rinadigan matnlar `public/i18n.js` da: `uz`, `ru`, `en` katalogi. `uzc` (kirill) lotin `uz` dan avtomatik o'giriladi.
- Yangi matn qo'shilsa — **uchala katalogga ham** bir xil kalit bilan qo'shing. Serverda `addLog(key, params)` / `note(player, key, params)`, brauzerda `t(key, params)`.
- Kod ichida matnni to'g'ridan-to'g'ri yozmang; `{role}` va `{was}` parametrlari avtomatik rol nomiga aylanadi.
- Standart til — o'zbekcha; boshqa tilni foydalanuvchi o'zi tanlaydi.

## Boshqa
- `profanity.js` — chat va ismlar uchun so'kinish filtri (serverda).
- Diktor (nutq sintezi) foydalanuvchi so'rovi bilan olib tashlangan — qayta qo'shmang.

## Git va joylash
- GitHub: https://github.com/nazokat8324-max/mafia-online (branch: `main`)
- Git muallifi: `nazokat8324-max` <nazokat8324@gmail.com>
- Claude commit qilishi va `main` branchga push qilishi mumkin (egasi ruxsat bergan).
- Render (bepul tarif) `render.yaml` orqali joylanadi: `main` branchga qilingan har bir push saytni avtomatik yangilaydi.
- Push qilishdan oldin `npm test` o'tishi kerak.
