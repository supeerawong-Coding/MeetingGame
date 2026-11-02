# AGENTS.md — กฎการทำงานสำหรับ AI Agent / ผู้พัฒนา

ไฟล์นี้กำหนด **วิธีดำเนินการเวลาแก้ไขโค้ด** ของโปรเจกต์ **ATHENA**
ให้ปฏิบัติตามทุกครั้งก่อนส่งงาน (ก่อนถือว่างานเสร็จ)

---

## 1. หลักการพื้นฐาน

1. **ต้องใช้ Git เสมอ** ทุกครั้งที่แก้ไข เพิ่ม ลบ หรือย้ายไฟล์
   * ห้ามแก้ไขไฟล์ค้างไว้โดยไม่ commit
   * ห้าม `git push` ตรง `main` โดยไม่ผ่านขั้นตอนด้านล่าง
2. **ห้าม commit ความลับ**
   * อนุญาตเฉพาะ `SUPABASE_URL` และ `anon key` ใน `js/config.js` (ค่าสาธารณะตาม design ของ Supabase)
   * ห้ามเดาหรือกรอกค่า key จริง ๆ แทนผู้ใช้ — ถ้าเป็นค่า placeholder (`YOUR_PROJECT`, `YOUR_ANON`) ให้คงไว้เช่นเดิม
   * ห้ามเพิ่ม `service_role` key ลงไฟล์ใด ๆ ใน repo เด็ดขาด
3. **ห้ามแก้ Schema มั่ว** — ตารางถูกกำหนดใน `sql/schema.sql`
   ถ้าต้องเพิ่มคอลัมน์/ตาราง ให้แก้ `sql/schema.sql` **และ**เพิ่มไฟล์ย่อยใน `sql/migrations/` พร้อมอธิบายใน `README.md`
4. **ห้ามส่ง `correct_option` ไปหน้า Player** — ดู `js/player.js` (`loadQuestions`)
   ทุกการเปลี่ยนแปลงที่แตะการดึงข้อมูลฝั่ง Player ต้องตรวจข้อนี้เป็นพิเศษ
5. **รักษารูปแบบเดิม** ของโค้ดรอบข้าง: Vanilla JS (IIFE + `'use strict'`), คอมเมนต์ภาษาไทย,
   ใช้ตัวช่วยจาก `js/athena.js` (`A.$`, `A.esc`, `A.toast`, `A.buzz`) แทนการเขียนซ้ำ

---

## 2. Workflow การแก้ไขโค้ด (บังคับ)

ทำตามลำดับนี้ทุกครั้ง:

### ขั้นที่ 1 — เช็คสถานะก่อนเริ่ม

```bash
git status                 # ต้องไม่มีไฟล์ค้างที่ไม่รู้จัก
git pull origin main       # อัปเดตให้เป็นล่าสุดเสมอ
```

ถ้า `git log` ขึ้น `does not have any commits yet` (repo ใหม่) ให้ข้าม `git pull` ไปทำ commit แรกก่อน

### ขั้นที่ 2 — สร้าง Branch สำหรับงานนั้น

```bash
git checkout -b <ประเภท>/<คำอธิบายสั้น>
```

รูปแบบชื่อ branch: `feat/…`, `fix/…`, `docs/…`, `chore/…`, `refactor/…`
ตัวอย่าง: `feat/player-vibration`, `fix/room-resume`, `docs/readme-setup`

### ขั้นที่ 3 — แก้ไขโค้ด

* อ่านไฟล์ที่เกี่ยวข้องก่อนแก้เสมอ
* เปลี่ยนน้อยที่สุดเท่าที่จำเป็น (Keep changes focused)
* ถ้าแตะหลาย ๆ หน้า (เช่น เพิ่มตัวแปรใหม่ใน `js/athena.js`) ให้ตรวจทุกหน้าที่เรียกใช้

### ขั้นที่ 4 — ทดสอบก่อน commit

```bash
# 1) เช็คไวยากรณ์ JavaScript ทุกไฟล์ที่แก้
node --check js/athena.js
node --check js/admin.js
node --check js/host.js
node --check js/player.js

# 2) เปิดเว็บทดสอบจริง
npx serve .
```

**Checklist ทดสอบด้วยตนเอง**

- [ ] `index.html` / `admin.html` / `host.html` / `player.html` เปิดได้ทุกหน้า ไม่มี Error ใน Console
- [ ] หน้า Admin: สร้าง/แก้ไข/ลบ ชุดข้อสอบ และคำถาม ได้ครบทุกปุ่ม
- [ ] กด “▶ เริ่มเล่น” จาก Admin แล้วไปถึงหน้า Host พร้อมชื่อชุดข้อสอบถูกต้อง
- [ ] หน้า Host: สร้างห้อง → แสดง PIN + QR → มีผู้เล่นเข้า (Realtime)
- [ ] เริ่มเกม → หน้า Player เปลี่ยนเป็นปุ่มตอบ **โดยไม่ refresh**
- [ ] ตอบแล้วปุ่มล็อก กดซ้ำไม่ได้
- [ ] หมดเวลา / กดจบข้อ → กราฟแท่ง + เฉลย + Leaderboard แสดงถูกต้อง
- [ ] ข้อถัดไป/จบเกม ทำงานถูกต้องทั้ง Host และ Player
- [ ] หน้า Player **ไม่มี** ค่า `correct_option` ในการโหลดข้อมูล (ตรวจที่ Network tab)

### ขั้นที่ 5 — Commit (Conventional Commits)

```bash
git add <ไฟล์ที่แก้>          # ระบุไฟล์ให้ชัดเจน ห้าม git add -A แบบสุ่ม
git commit -m "<type>: <คำอธิบายสั้นเป็นภาษาอังกฤษ>"
```

รูปแบบ: `type` อยู่ในชุด `feat` `fix` `docs` `style` `refactor` `perf` `test` `chore`

ตัวอย่าง:

```
feat: add speed-based scoring rpc
fix: prevent duplicate answer on player pad
docs: explain realtime channel filters
chore: split config into js/config.js
```

* ข้อความต้องสื่อสารว่า **แก้อะไร** ไม่ใช่แก้ไฟล์อะไร
* ถ้ามีหลายงานที่ไม่เกี่ยวกัน → แยกเป็นหลาย commit

### ขั้นที่ 6 — Push และเปิด Pull Request

```bash
git push -u origin <branch-name>
```

* เปิด **Pull Request** ไปยัง `main` แล้วให้ทบทวนก่อน merge
* **ห้าม force push** (`git push --force`) เข้า branch หลัก
* ถ้า repo ยังไม่มี commit แรก ให้ commit งานแรกไปก่อน แล้วค่อยทำ PR ครั้งถัดไป

---

## 3. โครงสร้างโค้ดที่ต้องรักษาไว้

| ไฟล์ | หน้าที่ | ข้อควรระวัง |
| --- | --- | --- |
| `js/config.js` | ค่าตั้งค่า Supabase ทั้งหมด | แก้ที่นี่ที่เดียวเมื่อเปลี่ยน Project |
| `js/athena.js` | helper ร่วมทุกหน้า | เพิ่มฟังก์ชันใหม่ที่นี่ อย่าเขียนซ้ำในแต่ละหน้า |
| `js/admin.js` | CRUD ชุดข้อสอบ/คำถาม | `order_index` ต้องเรียงตรงกับที่ Host/Player ใช้ (array index) |
| `js/host.js` | ตัวดำเนินเกมทั้งหมด | ทุกการเปลี่ยนสถานะต้อง `UPDATE` ตาราง `rooms` |
| `js/player.js` | ฝั่งผู้เล่น | ห้ามดึง `correct_option`; ล็อกปุ่มทันทีที่กด |
| `sql/schema.sql` | DDL + RLS + Realtime + RPC | ต้องรันซ้ำได้ (idempotent) |

**ลำดับการโหลดสคริปต์ใน HTML (ห้ามสลับ):**
`supabase CDN → (qrcodejs ที่ host.html) → js/config.js → js/athena.js → js/<page>.js`

---

## 4. เมื่อต้องแก้ Database

1. แก้ `sql/schema.sql` ให้เป็นแหล่งความจริง (single source of truth)
2. สร้างไฟล์ `sql/migrations/<วันที่>_<คำอธิบาย>.sql` สำหรับโปรเจกต์ที่ Deploy ไปแล้ว
3. ทดสอบรัน `sql/schema.sql` ซ้ำบน Supabase SQL Editor ต้องไม่ error
4. อัปเดตตาราง Schema ใน `README.md` ให้ตรงเสมอ

---

## 5. เมื่อต้องเพิ่ม Dependency (CDN)

* โปรเจกต์นี้ไม่มี Build step — ใช้ `<script>` จาก CDN ล้วน
* ต้องมีเหตุผลรองรับ และใส่ **fallback** ถ้าโหลดไม่ได้ (ดูตัวอย่าง QR Code ใน `js/host.js`)
* ห้ามใส่ library ที่ต้อง compile/build โดยไม่จำเป็น

---

## 6. Definition of Done (งานถือว่าเสร็จเมื่อ)

- [ ] โค้ดผ่าน `node --check` ทุกไฟล์ที่แก้
- [ ] ทดสอบตาม Checklist ในขั้นที่ 4 ครบ
- [ ] ไม่มี `console.error` / Uncaught exception ตอนทดสอบ
- [ ] ไม่มีความลับหรือ key จริงหลุดเข้า commit
- [ ] `README.md` อัปเดตตรงกับพฤติกรรมใหม่ (ถ้ามี)
- [ ] Commit ตาม Conventional Commits และ Push ขึ้น Branch + เปิด PR แล้ว
