# 🏛️ ATHENA (อาเธน่า)

ระบบตอบคำถามสดแบบ **Kahoot-like** ที่ทำงานแบบ **Serverless & Realtime 100%**
Frontend เป็นตัวดำเนิน Logic ร่วมกับ **Supabase** (PostgreSQL + Realtime Pub/Sub)
และ deploy ฟรีบน **GitHub Pages**

| | |
| --- | --- |
| 📝 **Admin** | **Login ด้วย Username/Password** แล้วจัดการชุดข้อสอบและโจทย์คำถาม (ตัวเลือก A-D, เฉลย, คะแนน, เวลา) |
| 🖥️ **Host** | สร้างห้อง + PIN 6 หลัก + QR Code, Lobby รายชื่อ Realtime, Countdown, กราฟสรุป, Leaderboard Top 5 |
| 📱 **Player** | เข้าร่วมด้วย Game PIN, ปุ่มตอบสี 4 ปุ่มขนาดใหญ่ + Vibration, สรุป “ถูก/ผิด” ทันที |

---

## 📁 โครงสร้างโปรเจกต์

```
meeting_game/
├── index.html          # หน้าแรก (ลิงก์ไปยัง 3 หน้า)
├── admin.html          # หน้าจัดการคลังข้อสอบ
├── host.html           # หน้าจอผู้จัดงาน (โปรเจกเตอร์/TV)
├── player.html         # หน้าผู้เล่น (มือถือ)
├── css/
│   ├── style.css       # ตัวแปรสี + พื้นฐาน + ปุ่ม/ฟอร์ม/Toast
│   ├── admin.css
│   ├── host.css
│   └── player.css
├── js/
│   ├── config.js       # ★ ตั้งค่า Supabase (URL + anon key) — แยกไฟล์ต่างหาก
│   ├── athena.js       # ฟังก์ชันส่วนกลาง (client, toast, vibration, sound, QR url)
│   ├── admin.js
│   ├── host.js
│   └── player.js
├── sql/
│   ├── schema.sql      # ★ DDL ทั้งหมด + RLS + Realtime + RPC (รันครั้งเดียว)
│   └── migrations/     # สคริปต์อัปเดตสำหรับโปรเจกต์ที่ deploy ไปแล้ว
├── README.md
└── AGENTS.md           # กฎการพัฒนา/แก้ไขโค้ด (ใช้ Git)
```

---

## 🚀 เริ่มต้นใช้งาน

### ขั้นที่ 1 — สร้าง Supabase Project

1. ไปที่ [supabase.com](https://supabase.com) → **New Project**
2. เปิด **SQL Editor** → วางเนื้อหาทั้งหมดของ `sql/schema.sql` → **Run**
   * ไฟล์นี้สร้างตาราง `quizzes`, `questions`, `rooms`, `players`, `answers`
   * เปิด **RLS** + เพิ่มตารางเข้า **Realtime publication** อัตโนมัติ
   * สร้าง **RPC `submit_answer`** สำหรับตรวจคำตอบ/คำนวณคะแนน
3. ไปที่ **Project Settings → API** แล้วคัดลอก:
   * `Project URL`
   * `anon public` key

### ขั้นที่ 2 — ตั้งค่า `js/config.js`

```js
window.ATHENA_CONFIG = {
  SUPABASE_URL: 'https://xxxxxxxxxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...',
  APP_BASE_URL: '',              // เช่น https://your-name.github.io/meeting_game
  DEFAULT_TIME_LIMIT: 20,
  DEFAULT_POINTS: 1000,
  ADMIN_USERNAME: 'admin',       // ★ เปลี่ยนก่อนใช้งานจริง
  ADMIN_PASSWORD: 'athena123'    // ★ เปลี่ยนก่อนใช้งานจริง
};
```

> 🔐 **หน้า Admin ต้อง Login ก่อนจัดการข้อสอบ** — ใส่ Username/Password ตามค่าใน `config.js`
> เป็นการป้องกันระดับหน้าจอเท่านั้น (โค้ดฝั่ง client เปิดอ่านได้) ถ้าต้องการความปลอดภัยจริงจัง
> ให้เพิ่ม Supabase Auth + จำกัดสิทธิ์ RLS

> ⚠️ ใช้ได้เฉพาะ **anon key** เท่านั้น — **ห้าม**วาง Service Role Key ลงในโค้ดฝั่ง Front-end เด็ดขาด
> (GitHub Pages เปิดให้ทุกคนอ่านซอร์สโค้ดได้)

### ขั้นที่ 3 — รันทดสอบ locally

เปิดผ่านเว็บเซิร์ฟเวอร์ (แนะนำ เพราะ `file://` ถูกบล็อก CORS ในบางเบราว์เซอร์):

```bash
# วิธีใดก็ได้ เช่น
npx serve .
# หรือเปิดด้วย VS Code แล้วกด "Live Server"
```

### ขั้นที่ 4 — Deploy ขึ้น GitHub Pages

1. `git push` โค้ดขึ้น GitHub (ดูกฎการใช้ Git ใน `AGENTS.md`)
2. Repository → **Settings → Pages**
3. เซ็ต **Source = Deploy from a branch** → branch `main` → folder `/ (root)`
4. เปิด `https://<user>.github.io/<repo>/` — เสร็จแล้ว 🎉

> ตั้งค่า `APP_BASE_URL` ใน `js/config.js` ให้ตรงกับ URL จริง
> เพื่อให้ QR Code ชี้ไปยัง `player.html` ถูกต้อง

---

## 🎮 วิธีเล่น

```
┌────────────┐   เลือกชุดข้อสอบ    ┌────────────┐
│ admin.html │ ─── “▶ เริ่มเล่น” ─▶ │ host.html  │  สร้างห้อง → แสดง PIN + QR
└────────────┘                     └─────┬──────┘
                                         │ ผู้เล่นสแกน QR / ใส่ PIN
                                         ▼
                                   ┌────────────┐
                                   │player.html │  ใส่ชื่อเล่น → จอ “คุณอยู่ในเกมแล้ว!”
                                   └────────────┘

Host กด “เริ่มเกม”
  → แสดงโจทย์ + Countdown + “ตอบแล้ว 15/20 คน” (Realtime)
  → เวลาหมด / กด “จบข้อนี้” → โชว์กราฟแท่ง A-D + เฉลย + Top 5
  → กด “ข้อถัดไป” → หน้า Player เปลี่ยนปุ่มตอบทันที (ไม่โหลดหน้าใหม่)
  → ข้อสุดท้าย → จบเกม + โพเดียม
```

---

## 🗄️ Database Schema

### `quizzes` — ชุดข้อสอบ

| Column | Type | รายละเอียด |
| --- | --- | --- |
| `id` | `uuid` | PK (default `gen_random_uuid()`) |
| `title` | `text` | ชื่อชุดข้อสอบ |
| `description` | `text` | คำอธิบาย (nullable) |
| `created_at` | `timestamptz` | default `now()` |

### `questions` — โจทย์คำถาม

| Column | Type | รายละเอียด |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `quiz_id` | `uuid` | FK → `quizzes.id` (ON DELETE CASCADE) |
| `question_text` | `text` | ข้อความคำถาม |
| `options` | `jsonb` | `["A","B","C","D"]` |
| `correct_option` | `int4` | `0`=A, `1`=B, `2`=C, `3`=D |
| `time_limit` | `int4` | วินาที (default `20`) |
| `points` | `int4` | คะแนน (default `1000`) |
| `order_index` | `int4` | ลำดับข้อ |

### `rooms` — สถานะห้อง (Realtime)

| Column | Type | รายละเอียด |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `room_code` | `text` | PIN 6 หลัก (UNIQUE, INDEX) |
| `quiz_id` | `uuid` | FK → `quizzes.id` |
| `status` | `text` | `lobby` / `playing` / `showing_result` / `ended` |
| `current_question_index` | `int4` | เริ่มที่ `0` |
| `created_at` | `timestamptz` | default `now()` |

### `players` — รายชื่อผู้เล่น (Realtime)

| Column | Type | รายละเอียด |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `room_id` | `uuid` | FK → `rooms.id` (CASCADE) |
| `nickname` | `text` | ชื่อเล่น |
| `total_score` | `int4` | คะแนนสะสม (default `0`) |
| `created_at` | `timestamptz` | default `now()` |

### `answers` — คำตอบ (Realtime)

| Column | Type | รายละเอียด |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `room_id` | `uuid` | FK → `rooms.id` |
| `player_id` | `uuid` | FK → `players.id` |
| `question_id` | `uuid` | FK → `questions.id` |
| `selected_option` | `int4` | `0-3` |
| `is_correct` | `bool` | ตอบถูกหรือไม่ |
| `score_earned` | `int4` | คะแนนที่ได้ |
| `response_time_ms` | `int4` | เวลาที่ใช้ตอบ (ms) |
| — | — | **UNIQUE (room_id, player_id, question_id)** ป้องกันตอบซ้ำ |

---

## ⚡ สถาปัตยกรรม Realtime (Pub/Sub)

หลักการสำคัญ: **ฟังเฉพาะสิ่งที่จำเป็น** เพื่อลดภาระ Database

| หน้าจอ | สมัครรับ (subscribe) | เหตุผล |
| --- | --- | --- |
| `player.html` | `rooms` WHERE `id = eq.<room_id>` | รับสถานะ/ลำดับข้อ → เปลี่ยนหน้าจอทันที |
| `player.html` | `players` WHERE `room_id = eq.<room_id>` | นับจำนวนผู้เล่นในจอ Waiting |
| `host.html` | `players` WHERE `room_id = eq.<room_id>` | รายชื่อเข้าห้องแบบเรียลไทม์ + Leaderboard |
| `host.html` | `answers` WHERE `room_id = eq.<room_id>` | นับ “ตอบแล้ว X/Y” + กราฟสรุป |

**กลไกเปลี่ยนหน้า:** เมื่อ Host กด “ข้อถัดไป” → `UPDATE rooms SET current_question_index = n`
→ หน้า Player ที่ subscribe อยู่ได้รับ event ทันที → สั่งเปลี่ยนปุ่มตอบ **โดยไม่ต้องโหลดหน้าเว็บใหม่**

---

## 🔐 การรักษาความปลอดภัยของเฉลย

1. **หน้า Player ไม่ดึง `correct_option`**
   เลือกคอลัมน์เฉพาะ `id, question_text, options, time_limit, points, order_index` เท่านั้น
2. **ตรวจคะแนนผ่าน RPC `submit_answer` (SECURITY DEFINER)**
   * ตรวจว่าห้องอยู่ในสถานะ `playing` และเป็นคำถามลำดับปัจจุบันจริง
   * ป้องกันการตอบซ้ำ (unique index + ตรวจในฟังก์ชัน)
   * คำนวณคะแนนและอัปเดต `players.total_score` ในฝั่ง Database
   * คืนค่ากลับเพียง `{ ok: true }` — ไม่ส่งเฉลยกลับไป
3. **โชว์ “ถูก/ผิด” หลังหมดเวลาเท่านั้น**
   หน้า Player ดึง `answers` ของตัวเองเมื่อ Host เปลี่ยนสถานะเป็น `showing_result`

### สูตรคะแนนตามความเร็ว

```
Score = BasePoints × ( 1 − ResponseTime / (TimeLimit × 2) )
```

* ตอบผิด = 0 คะแนน
* ตอบถูกแต่ช้าเกิน `2 × เวลาของข้อ` = 0 คะแนน
* ระบบ `round` แล้วตัดที่ 0 — ทุกค่าในสูตรต้องเป็นหน่วยเดียวกัน
  (เก็บ `response_time_ms` เป็น **มิลลิวินาที** จึงหารด้วย `time_limit × 2000` ms
  และจำกัดเวลาตอบไม่เกิน `time_limit × 2000` ms)

> ⚠️ **บทเรียนจริง:** เวอร์ชันแรกหาร `response_time_ms`(ms) ด้วย `time_limit × 2`(วินาที)
> ผลลัพธ์ติดลบเสมอ → ถูกตัดเป็น 0 ทุกครั้ง ผู้เล่นจึงเห็น "ถูกต้อง +0"
> แก้แล้วใน `sql/migrations/2026-11-02_fix_speed_scoring_units.sql`

ตัวอย่าง: ข้อ 1000 คะแนน เวลา 20 วินาที ตอบถูกใน 4 วินาที
→ `1000 × (1 − 4000/40000) = 900 คะแนน`

---

## 📱 UX/UI สำหรับมือถือ

* ปุ่มตอบ **ขนาดใหญ่** (min-height ~110-170px) กดง่ายแม้หน้าจอเล็ก
* สีมาตรฐาน Kahoot: 🔴 แดง / 🔵 น้ำเงิน / 🟡 เหลือง / 🟢 เขียว พร้อมรูปทรง A/B/C/D
* **Web Vibration API** — สั่นทันทีตอนกดตอบ และสั่นคนละแบบตอน “ถูก/ผิด”
* ปุ่ม **ล็อกทันที** หลังกด ป้องกันการตอบซ้ำ พร้อมสถานะ “ส่งคำตอบแล้ว”
* หน้า Player **ไม่แสดงโจทย์** — ให้มองจอใหญ่ของ Host เป็นหลัก (ประหยัดพื้นที่)

---

## ⚠️ ข้อจำกัดที่ควรรู้

| เรื่อง | รายละเอียด |
| --- | --- |
| ไม่มีระบบ Login | หน้า Admin เปิดให้แก้ไขข้อมูลได้ด้วย anon key — หากใช้งานจริงควรเพิ่ม **Supabase Auth** แล้วจำกัด policy ให้เฉพาะ admin |
| ตอบซ้ำ/ปลอมแปลงเวลา | `response_time_ms` มาจากฝั่งผู้เล่น (client) จึงถูกปลอมแปลงได้ หากต้องการให้แน่นกว่านี้ ให้เพิ่มคอลัมน์ `rooms.question_started_at` แล้วให้ RPC คำนวณเวลาจากฝั่งเซิร์ฟเวอร์ |
| เห็นเฉลยผ่าน API | เนื่องจาก RLS เปิดอ่านตาราง `questions` ให้ `anon` (เพื่อให้ Admin ใช้งานได้) ผู้ที่ตั้งใจกด F12 จึงดึง `correct_option` ได้ — วิธีแก้ที่ถูกต้องคือแยกสิทธิ์ Admin ด้วย Auth หรือย้ายคำถามไปหลัง RPC |
| ห้องค้าง | ห้องเก่าไม่ถูกลบอัตโนมัติ — รัน `select cleanup_old_rooms(7);` ตามต้องการ |
| เวลาบนหน้าจอ | Countdown ของ Host และเวลาที่ Player วัดเองอาจคลาดเคลื่อนเล็กน้อยจากระยะเวลาเครือข่าย |

---

## 🔧 Troubleshooting

| อาการ | วิธีแก้ |
| --- | --- |
| ขึ้นกล่อง “ยังตั้งค่า Supabase ไม่เรียบร้อย” | ตรวจ `js/config.js` ว่าใส่ URL/key จริงแล้ว |
| `Permission denied` / RLS error | รัน `sql/schema.sql` ซ้ำได้ (idempotent) เพื่อสร้าง policy ครบทุกตาราง |
| หน้า Player ไม่เปลี่ยนเมื่อ Host กดข้อถัดไป | ตรวจว่ารัน SQL ส่วน **Realtime publication** แล้ว (หรือเปิด Table Editor → เลือกตาราง → **Publication → supabase_realtime**) |
| QR Code ไม่แสดง | ตรวจการเชื่อมต่อ CDN หรือตั้ง `APP_BASE_URL` แล้วใช้ลิงก์แทน |
| เสียงไม่ดัง | เบราว์เซอร์บล็อกเสียงก่อนมี interaction — ให้คลิกปุ่มใดก็ได้ก่อน 1 ครั้ง |

---

## 📜 License

MIT — ใช้งานได้เสรีทั้งการเรียนการสอนและเชิงพาณิชย์
