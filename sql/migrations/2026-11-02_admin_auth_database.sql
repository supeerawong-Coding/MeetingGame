-- ============================================================================
-- Migration: ย้ายระบบ Login หน้า Admin ไปไว้ในฐานข้อมูล (Database-backed Auth)
--
-- ปัญหาเดิม: เก็บ username/password ใน js/config.js ซึ่งเปิดอ่านได้จากซอร์สโค้ด
--             -> คนที่ clone หรือกด F12 ก็เข้าหน้า Admin ได้
--
-- วิธีใหม่:
--   1. รหัสผ่านเก็บเป็น bcrypt hash ในตาราง `admin_auth` (client อ่านไม่ได้)
--   2. หน้า Admin เรียก RPC `admin_login(username, password)` -> คืน token ชั่วคราว 12 ชม.
--   3. ทุกการแก้ไข/ลบ ต้องผ่าน RPC ที่รับ `p_token` และตรวจใน database
--   4. เพิกถอนสิทธิ์ INSERT/UPDATE/DELETE บน quizzes และ questions ของ anon
--      -> เรียก REST API ตรง ๆ ก็เขียนไม่ได้
--
-- วิธีใช้: รันทั้งหมดใน Supabase -> SQL Editor (รันซ้ำได้)
-- วันที่: 2026-11-02
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- ตาราง ----
create table if not exists public.admin_auth (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table if not exists public.admin_sessions (
  token      uuid primary key,
  username   text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ปิดไม่ให้ฝั่ง client อ่านสองตารางนี้เด็ดขาด
alter table public.admin_auth     enable row level security;
alter table public.admin_sessions enable row level security;

drop policy if exists "admin_auth_no_access"     on public.admin_auth;
drop policy if exists "admin_sessions_no_access" on public.admin_sessions;
create policy "admin_auth_no_access"     on public.admin_auth     for all to anon, authenticated using (false) with check (false);
create policy "admin_sessions_no_access" on public.admin_sessions for all to anon, authenticated using (false) with check (false);

revoke all on public.admin_auth     from anon, authenticated;
revoke all on public.admin_sessions from anon, authenticated;

-- --------------------------------------------- เพิกถอนสิทธิ์เขียนข้อมูล ---
-- แอดมินแก้ไขได้เฉพาะผ่าน RPC ด้านล่างเท่านั้น (ยังอ่านได้ตามเดิม)
revoke insert, update, delete on public.quizzes, public.questions from anon, authenticated;

-- ------------------------------------------------------- ฟังก์ชันช่วย ----
drop function if exists public.is_admin_session (uuid);
create function public.is_admin_session (p_token uuid) returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_token is null then
    return false;
  end if;
  return exists (
    select 1 from public.admin_sessions
     where token = p_token and expires_at > now()
  );
end;
$$;

-- --------------------------------------------------------- Login / Logout --
drop function if exists public.admin_login (text, text);
create function public.admin_login (p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_hash    text;
  v_user    text;
  v_token   uuid;
  v_expires timestamptz;
begin
  if p_username is null or p_password is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  end if;

  v_user := lower(btrim(p_username));
  select password_hash into v_hash from public.admin_auth where lower(username) = v_user;

  -- เทียบรหัสผ่านด้วย bcrypt (pgcrypto) — ไม่มีการคืนค่า hash กลับไปที่ client
  if v_hash is null or crypt(p_password, v_hash) <> v_hash then
    return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  end if;

  -- ล้าง session หมดอายุ และของ user คนเดิม
  delete from public.admin_sessions where expires_at < now() or username = v_user;

  v_token   := gen_random_uuid();
  v_expires := now() + interval '12 hours';
  insert into public.admin_sessions (token, username, expires_at)
  values (v_token, v_user, v_expires);

  return jsonb_build_object('ok', true, 'token', v_token, 'expires_at', v_expires);
end;
$$;

drop function if exists public.admin_logout (text);
create function public.admin_logout (p_token text) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if p_token is not null
     and p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    delete from public.admin_sessions where token = p_token::uuid;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

drop function if exists public.admin_session_valid (text);
create function public.admin_session_valid (p_token text) returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_token is null
     or p_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.is_admin_session(p_token::uuid);
end;
$$;

-- ------------------------------------------------- บันทึก/ลบ ชุดข้อสอบ ----
drop function if exists public.admin_save_quiz (uuid, uuid, text, text);
create function public.admin_save_quiz (
  p_token       uuid,
  p_id          uuid,
  p_title       text,
  p_description text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id    uuid;
  v_title text;
begin
  if not public.is_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then
    return jsonb_build_object('ok', false, 'error', 'title_required');
  end if;

  if p_id is null then
    insert into public.quizzes (title, description)
    values (v_title, nullif(btrim(coalesce(p_description, '')), ''))
    returning id into v_id;
  else
    update public.quizzes
       set title = v_title,
           description = nullif(btrim(coalesce(p_description, '')), '')
     where id = p_id
     returning id into v_id;

    if v_id is null then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

drop function if exists public.admin_delete_quiz (uuid, uuid);
create function public.admin_delete_quiz (p_token uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;
  delete from public.quizzes where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ----------------------------------------------------- บันทึก/ลบ คำถาม ----
drop function if exists public.admin_save_question (uuid, uuid, uuid, text, jsonb, int4, int4, int4, int4);
create function public.admin_save_question (
  p_token          uuid,
  p_id             uuid,
  p_quiz_id        uuid,
  p_question_text  text,
  p_options        jsonb,
  p_correct_option int4,
  p_time_limit     int4,
  p_points         int4,
  p_order_index    int4
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id      uuid;
  v_text    text;
  v_options jsonb;
begin
  if not public.is_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  v_text := btrim(coalesce(p_question_text, ''));
  if v_text = '' then
    return jsonb_build_object('ok', false, 'error', 'text_required');
  end if;

  if jsonb_typeof(p_options) is distinct from 'array'
     or jsonb_array_length(p_options) <> 4 then
    return jsonb_build_object('ok', false, 'error', 'options_required');
  end if;

  if exists (
    select 1 from jsonb_array_elements_text(p_options) as t(opt)
     where btrim(coalesce(t.opt, '')) = ''
  ) then
    return jsonb_build_object('ok', false, 'error', 'options_required');
  end if;

  if p_correct_option is null or p_correct_option not between 0 and 3 then
    return jsonb_build_object('ok', false, 'error', 'correct_required');
  end if;

  if not exists (select 1 from public.quizzes where id = p_quiz_id) then
    return jsonb_build_object('ok', false, 'error', 'quiz_not_found');
  end if;

  select jsonb_agg(btrim(t.opt))
    into v_options
    from jsonb_array_elements_text(p_options) as t(opt);

  if p_id is null then
    insert into public.questions (quiz_id, question_text, options, correct_option, time_limit, points, order_index)
    values (p_quiz_id, v_text, v_options,
            p_correct_option,
            coalesce(p_time_limit, 20),
            coalesce(p_points, 1000),
            coalesce(p_order_index, 0))
    returning id into v_id;
  else
    update public.questions
       set question_text = v_text,
           options = v_options,
           correct_option = p_correct_option,
           time_limit = coalesce(p_time_limit, time_limit),
           points = coalesce(p_points, points),
           order_index = coalesce(p_order_index, order_index)
     where id = p_id and quiz_id = p_quiz_id
     returning id into v_id;

    if v_id is null then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

drop function if exists public.admin_delete_question (uuid, uuid);
create function public.admin_delete_question (p_token uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;
  delete from public.questions where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------- สิทธิ์เรียก RPC ----
revoke all on function public.is_admin_session (uuid)     from public;
revoke all on function public.admin_login (text, text)    from public;
revoke all on function public.admin_logout (text)         from public;
revoke all on function public.admin_session_valid (text)  from public;
revoke all on function public.admin_save_quiz (uuid, uuid, text, text) from public;
revoke all on function public.admin_delete_quiz (uuid, uuid) from public;
revoke all on function public.admin_save_question (uuid, uuid, uuid, text, jsonb, int4, int4, int4, int4) from public;
revoke all on function public.admin_delete_question (uuid, uuid) from public;

grant execute on function public.admin_login (text, text)    to anon, authenticated;
grant execute on function public.admin_logout (text)         to anon, authenticated;
grant execute on function public.admin_session_valid (text)  to anon, authenticated;
grant execute on function public.admin_save_quiz (uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.admin_delete_quiz (uuid, uuid) to anon, authenticated;
grant execute on function public.admin_save_question (uuid, uuid, uuid, text, jsonb, int4, int4, int4, int4) to anon, authenticated;
grant execute on function public.admin_delete_question (uuid, uuid) to anon, authenticated;

-- ------------------------------------------------------ บัญชีแอดมิน ------
-- ★ แก้ค่า `v_password` (และ `v_username` ถ้าต้องการ) ก่อนรัน
--   จงใจ "ไม่ใส่รหัสผ่านเริ่มต้นไว้ในโค้ด" — ถ้าไม่แก้ คำสั่งจะขึ้นข้อผิดพลาด
--   เพื่อกันลืม และกันคนที่ clone โค้ดนำค่าเริ่มต้นไปล็อกอินได้
do $$
declare
  v_username text := 'admin';
  v_password text := 'เปลี่ยนรหัสผ่านตรงนี้';
begin
  perform set_config('search_path', 'public, extensions', true);

  if v_password = 'เปลี่ยนรหัสผ่านตรงนี้'
     and not exists (select 1 from public.admin_auth) then
    raise exception 'ยังไม่ได้ตั้งรหัสผ่านแอดมิน — แก้ค่า v_password ในไฟล์นี้ก่อนรัน';
  end if;

  insert into public.admin_auth (username, password_hash)
  values (v_username, crypt(v_password, gen_salt('bf')))
  on conflict (username) do nothing;
end $$;

-- เปลี่ยนรหัสผ่านภายหลัง:
--   update public.admin_auth
--      set password_hash = crypt('รหัสผ่านใหม่', gen_salt('bf'))
--    where username = 'admin';

-- ============================================================================
-- ทดสอบหลังรัน:
--   select public.admin_login('admin', 'รหัสของคุณ');  -- ok = true
--   select public.admin_login('admin', 'ผิด');          -- ok = false
--   select public.admin_session_valid('not-a-uuid');    -- false
-- ============================================================================
