-- ============================================================================
-- Migration: แก้ 2 บั๊คใน RPC `submit_answer`
--
-- บั๊ค 1 — คะแนน = 0 เสมอ (unit mismatch ในสูตร Speed-based Scoring)
--   เดิม: v_elapsed(มิลลิวินาที) / (time_limit * 2.0 = วินาที) → ผลลัพธ์ติดลบ
--         → ถูก greatest(..,0) = 0 ทุกครั้งที่ตอบถูก
--   แก้:  หารด้วย (time_limit * 2000.0) ซึ่งเป็นหน่วย ms ตรงสูตร
--
-- บั๊ค 2 — คำตอบถูกปฏิเสธทั้งข้อ (wrong_question) เมื่อ order_index ไม่ต่อเนื่อง
--   เดิม: เทียบ rooms.current_question_index กับ questions.order_index ตรง ๆ
--         ถ้าลบ/เพิ่มคำถามแล้ว order_index ไม่เริ่มจาก 0 หรือมีช่องว่าง
--         → ผู้เล่นตอบไม่ได้เลย (ไม่มีคำตอบในตาราง → ไม่มีคะแนน)
--   แก้:  หาคำถามตาม "ลำดับที่ Host/Player แสดงจริง" (row_number เรียง
--         order_index, created_at) ซึ่งตรงกับ array index ที่ใช้แสดงเสมอ
--
-- วิธีใช้: รันไฟล์นี้ทั้งหมดใน Supabase -> SQL Editor หนึ่งครั้ง
--          (create or replace function = รันซ้ำได้ ไม่กระทบข้อมูลเดิม)
--
-- วันที่: 2026-11-02
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

  -- ★ แก้ไขตรงนี้: หน่วยต้องเป็นมิลลิวินาทีทั้งคู่
  --   จำกัดช่วงเวลาให้อยู่ใน [0, TimeLimit * 2000] (จุดที่คะแนนเป็น 0 ตามสูตร)
  v_elapsed := least(greatest(coalesce(p_response_time_ms, 0), 0), v_question.time_limit * 2000);

  v_correct := (p_selected_option = v_question.correct_option);
  if v_correct then
    -- Score = BasePoints * (1 - ResponseTime(ms) / (TimeLimit * 2000 ms))
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

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.submit_answer (uuid, uuid, uuid, int4, int4) from public;
grant execute on function public.submit_answer (uuid, uuid, uuid, int4, int4) to anon, authenticated;

-- ============================================================================
-- ตรวจผลลัพธ์หลังรัน (ตัวอย่าง: เวลาตอบ 4 วินาที บนข้อ time_limit=20, points=1000)
--   คาดว่าได้ 1000 * (1 - 4000/40000) = 900
--   select 1000 * (1 - 4000::numeric / (20 * 2000.0))  as expected_score;
-- ============================================================================
