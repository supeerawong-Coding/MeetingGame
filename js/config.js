/**
 * ATHENA — ไฟล์ตั้งค่า (Configuration)
 * ----------------------------------------------------------------------------
 * แยกไฟล์นี้ออกจากไฟล์อื่นเพื่อให้เปลี่ยน Project หรือ Environment ได้ทันที
 * โดยไม่ต้องแก้ไขโค้ดส่วนอื่น
 *
 * ค่า SUPABASE_URL และ SUPABASE_ANON_KEY เป็น "ค่าสาธารณะ" ของ Supabase
 * (anon key ถูกออกแบบมาให้ฝั่ง Client ใช้งานได้ + คุมด้วย RLS ที่ฝั่ง Database)
 * ห้ามวาง Service Role Key ลงในไฟล์นี้เด็ดขาด เพราะ GitHub Pages เปิดให้ทุกคนอ่านโค้ดได้
 */
window.ATHENA_CONFIG = {
  // รูปแบบ: https://xxxxxxxxxxxx.supabase.co
  SUPABASE_URL: 'https://mkefdosrowxvzppfrixz.supabase.co',

  // ค่า anon public key จาก Supabase -> Project Settings -> API
  SUPABASE_ANON_KEY: 'sb_publishable_s5jwFVaYNgREBuUJf_AnDQ_W7VzOrke',

  // (ทางเลือก) ใช้เมื่อต้องการระบุ URL ของเว็บแบบตายตัว เช่นตอนสร้าง QR Code
  // ปล่อยว่างไว้ ระบบจะใช้ path ของหน้า host.html ปัจจุบันโดยอัตโนมัติ
  // ตัวอย่าง: 'https://your-name.github.io/meeting_game'
  APP_BASE_URL: 'https://supeerawong-coding.github.io/MeetingGame/',

  // ค่าเริ่มต้นเวลาตอบ (วินาที) ที่ใช้ตอนสร้างคำถามใหม่
  DEFAULT_TIME_LIMIT: 20,

  // ค่าเริ่มต้นคะแนนต่อข้อ
  DEFAULT_POINTS: 1000
};
