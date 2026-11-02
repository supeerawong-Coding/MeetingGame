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
