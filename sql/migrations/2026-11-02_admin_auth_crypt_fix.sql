-- ============================================================================
-- FIX: ฟังก์ชัน `admin_login` เรียก crypt() ไม่ได้
--
-- อาการ: เรียก admin_login แล้วได้
--         404 / function crypt(text, text) does not exist
--
-- สาเหตุ: ตัวฟังก์ชันถูกสร้างด้วย `set search_path = public`
--         แต่บน Supabase นามสกุล pgcrypto ถูกติดตั้งอยู่ใน schema `extensions`
--         จึงมองไม่เห็น crypt() / gen_salt()
--
-- วิธีใช้: รันทั้งหมดใน Supabase -> SQL Editor (รันซ้ำได้)
-- วันที่: 2026-11-02
-- ============================================================================

-- 1) แก้ search_path ของฟังก์ชัน (ไม่ต้องสร้างฟังก์ชันใหม่ ไม่แตะโค้ดอื่น)
alter function public.admin_login (text, text) set search_path = public, extensions;

-- 2) บัญชีแอดมิน
--    - ถ้าบัญชีมีอยู่แล้ว และ `v_password` ปล่อยว่างไว้ -> ไม่ทำอะไร (ใช้รหัสเดิม)
--    - ถ้าใส่ค่า `v_password` -> สร้าง/เปลี่ยนรหัสผ่านเป็นค่านั้น
--    - ถ้าบัญชียังไม่มี และไม่ใส่ค่า -> ขึ้นข้อผิดพลาดเพื่อกันลืม
do $$
declare
  v_username text := 'admin';
  v_password text := '';  -- ★ ใส่รหัสผ่านของคุณที่นี่ (ปล่อยว่าง = ไม่แก้ไข)
begin
  perform set_config('search_path', 'public, extensions', true);

  if v_password <> '' then
    insert into public.admin_auth (username, password_hash)
    values (v_username, crypt(v_password, gen_salt('bf')))
    on conflict (username) do update set password_hash = excluded.password_hash;

  elsif not exists (select 1 from public.admin_auth where username = v_username) then
    raise exception 'ยังไม่มีบัญชีแอดมิน — ใส่ค่า v_password ในไฟล์นี้ก่อนรัน';
  end if;
end $$;

-- ============================================================================
-- ทดสอบหลังรัน:
--   select public.admin_login('admin', 'รหัสของคุณ');   -- ต้องได้ ok = true
--   select public.admin_login('admin', 'ผิด');           -- ต้องได้ ok = false
-- ============================================================================
