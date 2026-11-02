-- ============================================================================
-- ATHENA (อาเธน่า) — Serverless Realtime Quiz  /  Database Schema
-- รันไฟล์นี้ทั้งหมดใน Supabase Dashboard -> SQL Editor หนึ่งครั้ง
-- สามารถรันซ้ำได้ (idempotent) เพราะใช้ IF NOT EXISTS / DROP ... IF EXISTS
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. quizzes — คลังชุดข้อสอบ
-- ----------------------------------------------------------------------------
create table if not exists public.quizzes (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. questions — โจทย์คำถาม (เก็บใน jsonb และมีเฉลยไว้เฉพาฝั่งเซิร์ฟเวอร์)
-- ----------------------------------------------------------------------------
create table if not exists public.questions (
  id             uuid primary key default gen_random_uuid(),
  quiz_id        uuid not null references public.quizzes (id) on delete cascade,
  question_text  text not null,
  options        jsonb not null default '["","","",""]'::jsonb,
  correct_option int4 not null default 0 check (correct_option between 0 and 3),
  time_limit     int4 not null default 20,
  points         int4 not null default 1000,
  order_index    int4 not null default 0
);

-- ----------------------------------------------------------------------------
-- 3. rooms — สถานะห้องเล่นสด (Realtime)
-- ----------------------------------------------------------------------------
create table if not exists public.rooms (
  id                     uuid primary key default gen_random_uuid(),
  room_code              text not null unique,
  quiz_id                uuid not null references public.quizzes (id) on delete cascade,
  status                 text not null default 'lobby'
                         check (status in ('lobby', 'playing', 'showing_result', 'ended')),
  current_question_index int4 not null default 0,
  created_at             timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4. players — รายชื่อผู้เล่น (Realtime)
-- ----------------------------------------------------------------------------
create table if not exists public.players (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms (id) on delete cascade,
  nickname    text not null,
  total_score int4 not null default 0,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 5. answers — คำตอบของผู้เล่น (Realtime)
--    unique index ป้องกันการตอบซ้ำในข้อเดียวกัน (นอเหนือจากการตรวจใน RPC)
-- ----------------------------------------------------------------------------
create table if not exists public.answers (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references public.rooms (id) on delete cascade,
  player_id        uuid not null references public.players (id) on delete cascade,
  question_id      uuid not null references public.questions (id) on delete cascade,
  selected_option  int4 not null check (selected_option between 0 and 3),
  is_correct       bool not null default false,
  score_earned     int4 not null default 0,
  response_time_ms int4 not null default 0,
  created_at       timestamptz not null default now(),
  unique (room_id, player_id, question_id)
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
create index if not exists idx_questions_quiz   on public.questions (quiz_id, order_index);
create index if not exists idx_rooms_code       on public.rooms (room_code);
create index if not exists idx_rooms_quiz       on public.rooms (quiz_id);
create index if not exists idx_players_room     on public.players (room_id);
create index if not exists idx_answers_room     on public.answers (room_id, question_id);
create index if not exists idx_answers_player   on public.answers (player_id);

-- ----------------------------------------------------------------------------
-- Row Level Security
--    แอปทำงานแบบ Serverless (Frontend เป็นตัวดำเนิน Logic) จึงต้องเปิดสิทธิ์
--    ให้ role `anon` (Key สาธารณะบน GitHub Pages) ได้ทุกตาราง
--    -> หมายเหตุด้านความปลอดภัยใน README.md
-- ----------------------------------------------------------------------------
alter table public.quizzes   enable row level security;
alter table public.questions enable row level security;
alter table public.rooms     enable row level security;
alter table public.players   enable row level security;
alter table public.answers   enable row level security;

drop policy if exists "quizzes_all"   on public.quizzes;
drop policy if exists "questions_all" on public.questions;
drop policy if exists "rooms_all"     on public.rooms;
drop policy if exists "players_all"   on public.players;
drop policy if exists "answers_all"   on public.answers;

create policy "quizzes_all"   on public.quizzes   for all to anon, authenticated using (true) with check (true);
create policy "questions_all" on public.questions for all to anon, authenticated using (true) with check (true);
create policy "rooms_all"     on public.rooms     for all to anon, authenticated using (true) with check (true);
create policy "players_all"   on public.players   for all to anon, authenticated using (true) with check (true);
create policy "answers_all"   on public.answers   for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage on all sequences in schema public to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Realtime (Pub/Sub) — ต้องเพิ่มตาราง into publication `supabase_realtime`
--    * rooms     : Host สั่งเปลี่ยนข้อ -> Player เปลี่ยนหน้าจอทันที
--    * players   : รายชื่อใน Lobby / Leaderboard แบบ Realtime
--    * answers   : นับจำนวนคนตอบแล้ว + กราฟสรุปของ Host
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['rooms', 'players', 'answers'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ให้ Realtime ส่งข้อมูลเก่า (old record) ด้วย เผื่อต้องใช้ในอนาคต
-- ห่อใน DO block กันสคริปต์ทั้งหมดล้มถ้าสิทธิ์ไม่พอ
do $$
begin
  alter table public.rooms   replica identity full;
  alter table public.players replica identity full;
  alter table public.answers replica identity full;
exception
  when others then null;
end $$;

-- ============================================================================
-- RPC: submit_answer — ตรวจคำตอบ + คำนวณคะแนนตามความเร็ว (Speed-based Scoring)
--   Score = BasePoints * (1 - ResponseTime / (TimeLimit * 2))   (floor, >= 0)
--   * SECURITY DEFINER เพื่อให้ฝั่ง Player ส่งคำตอบได้โดยไม่ต้องเห็น correct_option
--   * ตรวจสถานะห้อง, ลำดับข้อ, และป้องกันการตอบซ้ำทุกครั้ง
-- ============================================================================
drop function if exists public.submit_answer (uuid, uuid, uuid, int4, int4);

create function public.submit_answer (
  p_room_id          uuid,
  p_player_id        uuid,
  p_question_id      uuid,
  p_selected_option  int4,
  p_response_time_ms int4
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room        public.rooms%rowtype;
  v_question    public.questions%rowtype;
  v_expected_id uuid;
  v_elapsed     int4;
  v_correct     boolean := false;
  v_score       int4 := 0;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room is null then
    return jsonb_build_object('ok', false, 'error', 'room_not_found');
  end if;
  if v_room.status <> 'playing' then
    return jsonb_build_object('ok', false, 'error', 'not_playing');
  end if;

  select * into v_question
    from public.questions
   where id = p_question_id and quiz_id = v_room.quiz_id;
  if v_question is null then
    return jsonb_build_object('ok', false, 'error', 'question_not_found');
  end if;

  -- ตรวจลำดับข้อตาม "ตำแหน่งที่ Host/Player แสดงจริง" (เรียง order_index, created_at)
  -- ไม่เทียบกับค่า order_index ตรง ๆ เพราะค่านั้นอาจไม่ต่อเนื่อง/เริ่มจาก 0
  -- (เช่น ลบคำถามข้อแรกออกไป แล้วเพิ่มคำถามใหม่) ซึ่งจะทำให้คำตอบถูกปฏิเสธทั้งข้อ
  select t.id into v_expected_id
    from (
      select id, row_number() over (order by order_index, created_at) as rn
        from public.questions
       where quiz_id = v_room.quiz_id
    ) t
   where t.rn = v_room.current_question_index + 1;

  if v_expected_id is distinct from p_question_id then
    return jsonb_build_object('ok', false, 'error', 'wrong_question');
  end if;

  if not exists (select 1 from public.players where id = p_player_id and room_id = p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'player_not_found');
  end if;

  if exists (
    select 1 from public.answers
     where room_id = p_room_id and player_id = p_player_id and question_id = p_question_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_answered');
  end if;

  -- จำกัดเวลาให้อยู่ในช่วง [0, time_limit * 2000 ms]  (จุดที่คะแนนเป็น 0 ตามสูตร)
  -- หมายเหตุ: ทุกค่าต้องเป็นหน่วย "มิลลิวินาที" เท่านั้น มิฉะนั้นคะแนนจะติดลบเสมอ
  v_elapsed := least(greatest(coalesce(p_response_time_ms, 0), 0), v_question.time_limit * 2000);

  v_correct := (p_selected_option = v_question.correct_option);
  if v_correct then
    -- Score = BasePoints * (1 - ResponseTime(ms) / (TimeLimit(s) * 2000))
    v_score := round(
      v_question.points * (1 - v_elapsed::numeric / (v_question.time_limit * 2000.0))
    )::int4;
    v_score := greatest(v_score, 0);
  end if;

  insert into public.answers (room_id, player_id, question_id, selected_option, is_correct, score_earned, response_time_ms)
  values (p_room_id, p_player_id, p_question_id, p_selected_option, v_correct, v_score, v_elapsed);

  update public.players
     set total_score = total_score + v_score
   where id = p_player_id;

  -- ตั้งใจส่งเฉพาะผลลัพธ์ขั้นต่ำ: หน้า Player จะโชว์ "ถูก/ผิด"
  -- ก็ต่อเมื่อ Host เปลี่ยนสถานะห้องเป็น showing_result เท่านั้น
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.submit_answer (uuid, uuid, uuid, int4, int4) from public;
grant execute on function public.submit_answer (uuid, uuid, uuid, int4, int4) to anon, authenticated;

-- ============================================================================
-- (ทางเลือก) ลบห้องเก่าอัตโนมัติ — รันเมื่อต้องการ
--   select public.cleanup_old_rooms();
-- ============================================================================
create or replace function public.cleanup_old_rooms (p_days int4 default 7)
returns int4
language sql
security definer
set search_path = public
as $$
  with removed as (
    delete from public.rooms
     where created_at < now() - make_interval(days => p_days)
    returning 1
  )
  select count(*)::int4 from removed;
$$;

grant execute on function public.cleanup_old_rooms (int4) to anon, authenticated;

-- ============================================================================
-- ระบบเข้าสู่ระบบหน้า Admin (Database-backed Auth)
--   รหัสผ่านเก็บเป็น bcrypt hash ในตาราง `admin_auth` — ไม่มีในซอร์สโค้ด
--   หน้า Admin ต้องเรียก RPC `admin_login` เพื่อขอ token (อายุ 12 ชม.)
--   การแก้ไข/ลบ ทุกครั้งแนบ token และตรวจในฝั่ง database
--   (ไฟล์เดียวกับ sql/migrations/2026-11-02_admin_auth_database.sql)
-- ============================================================================

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

alter table public.admin_auth     enable row level security;
alter table public.admin_sessions enable row level security;

drop policy if exists "admin_auth_no_access"     on public.admin_auth;
drop policy if exists "admin_sessions_no_access" on public.admin_sessions;
create policy "admin_auth_no_access"     on public.admin_auth     for all to anon, authenticated using (false) with check (false);
create policy "admin_sessions_no_access" on public.admin_sessions for all to anon, authenticated using (false) with check (false);

revoke all on public.admin_auth     from anon, authenticated;
revoke all on public.admin_sessions from anon, authenticated;

-- แอดมินแก้ไขได้เฉพาะผ่าน RPC ด้านล่างเท่านั้น (ยังอ่านได้ตามเดิม)
revoke insert, update, delete on public.quizzes, public.questions from anon, authenticated;

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

  if v_hash is null or crypt(p_password, v_hash) <> v_hash then
    return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  end if;

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

-- บัญชีแอดมิน: ★ แก้ค่า v_password ก่อนรัน (จงใจไม่ใส่รหัสผ่านเริ่มต้นในโค้ด)
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
