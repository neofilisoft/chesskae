# Chesskae ♟️

หมากรุกสากล (Player vs Player / Player vs AI / Online Match)

![Chess Game](chess.png)

## รันบน localhost

```bash
# ติดตั้ง dependency
npm install

# เปิดเซิร์ฟเวอร์ (ทั้ง frontend + Socket.IO)
npm start
```

เปิดเบราว์เซอร์ไปที่ **http://localhost:3000**

### โหมด Online
1. ผู้เล่นคนที่ 1 กด **Online Match → สร้างห้อง** แล้วเลือกสี
2. คัดลอกรหัสห้อง (6 ตัวอักษร)
3. ผู้เล่นคนที่ 2 กด **Online Match → เข้าร่วม** แล้วใส่รหัส

ทั้งสองคนต้องเปิดเว็บจาก URL เดียวกัน (เช่น localhost:3000) เพื่อให้ Socket เชื่อมต่อเซิร์ฟเวอร์เดียวกัน

---

## Deploy

### ทางเลือกที่แนะนำ (multiplayer ใช้งานได้)

| ส่วน | แนะนำ |
|------|--------|
| Backend (Socket.IO) | [Railway](https://railway.app) / [Render](https://render.com) / [Fly.io](https://fly.io) |
| Frontend | Vercel หรือเสิร์ฟจาก backend เดียวกัน |

**วิธีง่ายสุด:** deploy โปรเจกต์ทั้งก้อนไปที่ Railway/Render แล้วเปิด public URL  
ผู้เล่นทุกคนเข้า URL นั้น → multiplayer ใช้ได้ทันที

### Vercel (frontend เท่านั้น)

Vercel เป็น serverless → **ไม่รองรับ Socket.IO แบบ persistent**  
ถ้าต้องการวาง frontend บน Vercel:

1. Deploy backend ไปที่ Railway/Render ก่อน ได้ URL เช่น `https://chesskae-xxx.up.railway.app`
2. เปิดเกมด้วย query parameter:
   ```
   https://your-app.vercel.app/?server=https://chesskae-xxx.up.railway.app
   ```
   หรือตั้งค่าใน localStorage:
   ```js
   localStorage.setItem('CHESSKAE_SERVER_URL', 'https://chesskae-xxx.up.railway.app')
   ```

ไฟล์ `vercel.json` ตัวอย่าง (static only):

```json
{
  "version": 2,
  "builds": [{ "src": "**", "use": "@vercel/static" }],
  "routes": [{ "src": "/(.*)", "dest": "/$1" }]
}
```

---

## โครงสร้าง

```
chesskae/
├── index.html      # UI หลัก (ไม่แก้ design)
├── style.css       # สไตล์เดิม
├── script.js       # เกม logic + AI + Socket client
├── server.js       # Express + Socket.IO server
├── sfx/            # เสียง Move / Check / Checkmate
├── package.json
└── chess.png
```

## ฟีเจอร์

- ✅ Player vs Player (local)
- ✅ Player vs Computer (negamax + alpha-beta, เรียงลำดับ capture/promotion และเลือกความยาก 4 ระดับจาก Settings)
- ✅ Online Match (สร้าง/เข้าร่วมห้อง + sync หมาก, เซิร์ฟเวอร์บังคับที่นั่งสีและลำดับตาเดิน)
- ✅ Online clock (แต่ละเทิร์น 1:30 นาที, หมดเวลาแพ้พร้อมเหตุผล `Time Out`)
- ✅ Promotion, Check/Checkmate sound, Move hints, Volume
- ✅ รองรับ flip board

## สิ่งที่ปรับปรุง

- ห้องที่รอผู้เล่นยกเลิกได้ทันที และรหัสห้องถูกสร้างแบบหลีกเลี่ยงตัวอักษรที่สับสน
- ผู้เล่นสีดำเริ่มเกมด้วยมุมมองสีดำถูกต้อง
- ฝั่งเซิร์ฟเวอร์ไม่ยอมรับ move จากคนที่ไม่ได้อยู่ในห้อง, สีผิด หรือเดินไม่ตรงตา
- ปุ่ม New Game ใน Online จะรีเซ็ตพร้อมกันทั้งสองฝ่าย

## ควรเพิ่ม TypeScript มั้ย?

**ไม่จำเป็นตอนนี้**  
โปรเจกต์ขนาดนี้ (vanilla JS + jQuery + chess.js + chessboard.js) เขียน TypeScript จะต้อง rewrite เกือบทั้งหมดและเพิ่ม build step โดยไม่ได้อะไรมาก  
ถ้าอยาก scale ใหญ่ขึ้นในอนาคต (แยก module, unit test, monorepo) ค่อย migrate ก็ได้

## License

ดูไฟล์ `LICENSE`
