/**
 * ATHENA — หน้า Player (player.html)
 * ออกแบบสำหรับมือถือ: เรียบง่าย, ส่งคำตอบเร็ว, ปุ่มใหญ่ + Vibration
 *
 * หมายเหตุความปลอดภัยของเฉลย:
 *   - ดึงคำถามโดยเลือกเฉพาะคอลัมน์ที่จำเป็น (ไม่รวม `correct_option`)
 *   - การตรวจคะแนน/บันทึกคำตอบทำทั้งหมดผ่าน RPC `submit_answer` ฝั่ง Database
 *   - หน้าจอนี้จะโชว์ "ถูก/ผิด" ก็ต่อเมื่อ Host เปลี่ยนสถานะห้องเป็น `showing_result` เท่านั้น
 */
(function () {
  'use strict';

  var A = window.Athena;
  var $ = A.$;
  var esc = A.esc;
  var LETTERS = ['A', 'B', 'C', 'D'];
  var STORAGE_KEY = 'athena_player';

  if (!A.guard()) return;

  var client = null;
  var state = {
    roomId: null,
    roomCode: null,
    playerId: null,
    nickname: '',
    quizId: null,
    questions: [],
    qIndex: -1,
    startedAt: 0,
    answered: false,
    channel: null,
    room: null
  };

  /* ======================================================== Init ========= */
  async function init() {
    try {
      client = A.createClient();
    } catch (e) {
      A.toast(e.message, 'error');
      return;
    }

    bindEvents();

    var params = new URLSearchParams(location.search);
    var pin = params.get('pin');
    if (pin && /^\d{1,6}$/.test(pin)) $('#pin-input').value = pin;

    // กู้ค่าหลังจากกด F5
    var saved = loadSavedSession();
    if (saved) {
      var ok = await resume(saved);
      if (ok) return;
      clearSession();
    }
  }

  /* =================================================== Session =========== */
  function loadSavedSession() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveSession() {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          roomId: state.roomId,
          roomCode: state.roomCode,
          playerId: state.playerId,
          nickname: state.nickname
        })
      );
    } catch (e) {}
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    state.roomId = null;
    state.playerId = null;
    state.qIndex = -1;
    unsubscribe();
  }

  async function resume(saved) {
    var roomRes = await client
      .from('rooms')
      .select('id, room_code, quiz_id, status, current_question_index')
      .eq('id', saved.roomId)
      .maybeSingle();

    if (roomRes.error || !roomRes.data) return false;

    var playerRes = await client
      .from('players')
      .select('id, nickname')
      .eq('id', saved.playerId)
      .maybeSingle();

    if (playerRes.error || !playerRes.data) return false;

    var ok = await loadQuestions(roomRes.data.quiz_id);
    if (!ok) return false;

    state.roomId = roomRes.data.id;
    state.roomCode = roomRes.data.room_code;
    state.quizId = roomRes.data.quiz_id;
    state.playerId = playerRes.data.id;
    state.nickname = playerRes.data.nickname;
    state.room = roomRes.data;

    subscribeChannel();
    handleRoom(roomRes.data);
    return true;
  }

  /* ================================================== Join game ========== */
  async function joinGame(event) {
    event.preventDefault();

    var pin = $('#pin-input').value.trim();
    var nickname = $('#nickname-input').value.trim();
    var btn = $('#btn-join');

    if (!/^\d{6}$/.test(pin)) {
      A.toast('Game PIN ต้องเป็นตัวเลข 6 หลัก', 'error');
      return;
    }
    if (!nickname) {
      A.toast('กรุณาตั้งชื่อเล่น', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'กำลังเข้าร่วม…';

    try {
      var roomRes = await client
        .from('rooms')
        .select('id, room_code, quiz_id, status, current_question_index')
        .eq('room_code', pin)
        .maybeSingle();

      if (roomRes.error) {
        A.toast(A.errorMessage(roomRes.error, 'ค้นหาห้องไม่สำเร็จ'), 'error');
        return;
      }
      if (!roomRes.data) {
        A.toast('ไม่พบห้องนี้ ตรวจสอบ Game PIN อีกครั้ง', 'error');
        return;
      }

      var room = roomRes.data;
      if (room.status === 'ended') {
        A.toast('ห้องนี้จบเกมแล้ว', 'error');
        return;
      }

      var ok = await loadQuestions(room.quiz_id);
      if (!ok) return;

      var insertRes = await client
        .from('players')
        .insert({ room_id: room.id, nickname: nickname, total_score: 0 })
        .select()
        .single();

      if (insertRes.error) {
        A.toast(A.errorMessage(insertRes.error, 'เข้าร่วมไม่สำเร็จ'), 'error');
        return;
      }

      state.roomId = room.id;
      state.roomCode = room.room_code;
      state.quizId = room.quiz_id;
      state.playerId = insertRes.data.id;
      state.nickname = nickname;
      state.room = room;
      state.qIndex = -1;
      state.answered = false;

      saveSession();
      subscribeChannel();
      A.buzz(60);
      handleRoom(room);
    } finally {
      btn.disabled = false;
      btn.textContent = 'เข้าร่วม →';
    }
  }

  /** ดึงเฉพาะคอลัมน์ที่ปลอดภัย — ไม่รวม `correct_option` เด็ดขาด */
  async function loadQuestions(quizId) {
    var res = await client
      .from('questions')
      .select('id, question_text, options, time_limit, points, order_index')
      .eq('quiz_id', quizId)
      .order('order_index', { ascending: true })
      .order('created_at', { ascending: true });

    if (res.error) {
      A.toast(A.errorMessage(res.error, 'โหลดคำถามไม่สำเร็จ'), 'error');
      return false;
    }
    if (!res.data || res.data.length === 0) {
      A.toast('ชุดข้อสอบนี้ยังไม่มีคำถาม', 'error');
      return false;
    }
    state.questions = res.data;
    return true;
  }

  /* ================================================== Realtime ========== */
  /** Pub/Sub: subscribe เฉพาะแถวห้องของตัวเองเท่านั้น */
  function subscribeChannel() {
    unsubscribe();

    state.channel = client
      .channel('player-room-' + state.roomId)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: 'id=eq.' + state.roomId },
        function (payload) {
          if (!payload.new) return;
          state.room = payload.new;
          handleRoom(payload.new);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'players', filter: 'room_id=eq.' + state.roomId },
        function () {
          if (currentScreen() === 'waiting') refreshWaitingCount();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'players', filter: 'room_id=eq.' + state.roomId },
        function (payload) {
          if (payload.new && payload.new.id === state.playerId && currentScreen() === 'result') {
            $('#result-total').textContent = payload.new.total_score.toLocaleString('th-TH');
          }
        }
      )
      .subscribe();
  }

  function unsubscribe() {
    if (state.channel) {
      try { client.removeChannel(state.channel); } catch (e) {}
      state.channel = null;
    }
  }

  /* =============================================== Room state machine ==== */
  function handleRoom(room) {
    switch (room.status) {
      case 'lobby':
        showWaiting();
        break;

      case 'playing':
        if (state.qIndex !== room.current_question_index || currentScreen() === 'result') {
          startPad(room.current_question_index);
        }
        break;

      case 'showing_result':
        // ผู้เล่นที่เข้ามาระหว่างแสดงผล ให้อ้างอิงข้อปัจจุบันจากห้อง
        if (state.qIndex < 0) state.qIndex = room.current_question_index;
        showResult();
        break;

      case 'ended':
        showEnded();
        break;
    }
  }

  /* ================================================= Screens ============= */
  function showScreen(name) {
    ['join', 'waiting', 'question', 'result', 'ended'].forEach(function (s) {
      $('#screen-' + s).hidden = s !== name;
    });
    window.scrollTo(0, 0);
  }

  function currentScreen() {
    if (!$('#screen-join').hidden) return 'join';
    if (!$('#screen-waiting').hidden) return 'waiting';
    if (!$('#screen-question').hidden) return 'question';
    if (!$('#screen-result').hidden) return 'result';
    return 'ended';
  }

  function showWaiting() {
    showScreen('waiting');
    $('#waiting-nickname').textContent = state.nickname;
    refreshWaitingCount();
  }

  async function refreshWaitingCount() {
    var res = await client
      .from('players')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', state.roomId);
    if (!res.error) $('#waiting-count').textContent = res.count || 1;
  }

  /* ================================================= Answer pad ========== */
  function startPad(index) {
    var q = state.questions[index];
    if (!q) return;

    state.qIndex = index;
    state.startedAt = Date.now();
    state.answered = false;

    showScreen('question');
    $('#pad-counter').textContent = 'ข้อ ' + (index + 1) + '/' + state.questions.length;

    var pad = $('#pad');
    pad.classList.remove('is-locked');
    A.$$('.pad-btn', pad).forEach(function (btn) { btn.classList.remove('is-selected'); });
    $('#sent-state').hidden = true;

    A.buzz(45);
  }

  async function submitAnswer(option) {
    if (state.answered || state.qIndex < 0) return;

    var q = state.questions[state.qIndex];
    if (!q) return;

    // ล็อกปุ่มทันทีเพื่อป้องกันการกดซ้ำ (ตาม UX ที่กำหนด)
    state.answered = true;
    var pad = $('#pad');
    pad.classList.add('is-locked');
    var btn = pad.querySelector('.pad-btn[data-option="' + option + '"]');
    if (btn) btn.classList.add('is-selected');

    A.buzz([40, 40, 60]);

    var elapsed = Math.max(0, Date.now() - state.startedAt);

    var res = await client.rpc('submit_answer', {
      p_room_id: state.roomId,
      p_player_id: state.playerId,
      p_question_id: q.id,
      p_selected_option: option,
      p_response_time_ms: elapsed
    });

    if (res.error) {
      A.toast(A.errorMessage(res.error, 'ส่งคำตอบไม่สำเร็จ'), 'error');
      state.answered = false;
      pad.classList.remove('is-locked');
      if (btn) btn.classList.remove('is-selected');
      return;
    }

    if (res.data && res.data.ok === false) {
      if (res.data.error === 'already_answered') {
        // เคยตอบข้อนี้ไปแล้ว (เช่น กด F5 ระหว่างตอบ) -> คงสถานะ "ส่งคำตอบแล้ว"
      } else {
        // ห้องไม่ได้อยู่ในสถานะเล่น / เปลี่ยนข้อไปแล้ว -> ปลดล็อกเพื่อลองใหม่
        A.toast('หมดเวลาตอบข้อนี้แล้ว', 'error');
        state.answered = false;
        pad.classList.remove('is-locked');
        if (btn) btn.classList.remove('is-selected');
        return;
      }
    }

    $('#sent-option').textContent = 'คุณเลือกข้อ ' + LETTERS[option];
    $('#sent-state').hidden = false;
  }

  /* ================================================= Result ============== */
  async function showResult() {
    showScreen('result');
    $('#player-rank').hidden = false;

    // ล้างค่าของข้อที่แล้วออกก่อนดึงข้อมูลใหม่
    // กันไม่ให้เห็น "คะแนนของข้อที่แล้ว" ปรากฏค้างบนหน้าผลของข้อนี้
    $('#result-icon').textContent = '⏳';
    $('#result-title').textContent = 'กำลังสรุปผล…';
    $('#result-gain').textContent = '';
    $('#result-detail').textContent = '';

    var q = state.questions[state.qIndex];
    var card = $('#result-card');
    card.classList.remove('is-correct', 'is-wrong');

    var answerRes = null;
    if (q) {
      answerRes = await client
        .from('answers')
        .select('is_correct, score_earned, selected_option, response_time_ms')
        .eq('room_id', state.roomId)
        .eq('player_id', state.playerId)
        .eq('question_id', q.id)
        .maybeSingle();
    }

    var playersRes = await client
      .from('players')
      .select('id, total_score')
      .eq('room_id', state.roomId)
      .order('total_score', { ascending: false });

    var players = (playersRes.data || []).slice().sort(function (a, b) {
      return b.total_score - a.total_score;
    });
    var rank = players.findIndex(function (p) { return p.id === state.playerId; }) + 1;
    var me = players.find(function (p) { return p.id === state.playerId; });
    var total = me ? me.total_score : 0;

    $('#result-total').textContent = total.toLocaleString('th-TH');
    $('#result-rank').textContent = rank > 0 ? '#' + rank : '-';
    $('#player-rank').innerHTML = 'อันดับ <b>' + (rank > 0 ? rank : '-') + '</b> · ' + total.toLocaleString('th-TH');

    var answer = answerRes && !answerRes.error ? answerRes.data : null;

    if (answer && answer.is_correct) {
      card.classList.add('is-correct');
      $('#result-icon').textContent = '✔';
      $('#result-title').textContent = 'ถูกต้อง!';
      $('#result-gain').textContent = '+' + answer.score_earned;
      $('#result-detail').textContent =
        'ตอบข้อ ' + LETTERS[answer.selected_option] +
        ' · ใช้เวลา ' + (answer.response_time_ms / 1000).toFixed(1) + ' วินาที';
      A.buzz([50, 50, 50, 50, 120]);
    } else if (answer) {
      card.classList.add('is-wrong');
      $('#result-icon').textContent = '✘';
      $('#result-title').textContent = 'ผิดพลาด';
      $('#result-gain').textContent = '+0';
      $('#result-detail').textContent = 'คุณเลือกข้อ ' + LETTERS[answer.selected_option];
      A.buzz([120, 80, 120]);
    } else {
      card.classList.add('is-wrong');
      $('#result-icon').textContent = '⏳';
      $('#result-title').textContent = 'ไม่ได้ตอบข้อนี้';
      $('#result-gain').textContent = '+0';
      $('#result-detail').textContent = '';
      A.buzz(120);
    }
  }

  /* ================================================= Ended =============== */
  async function showEnded() {
    showScreen('ended');
    $('#player-rank').hidden = true;

    var playersRes = await client
      .from('players')
      .select('id, nickname, total_score')
      .eq('room_id', state.roomId)
      .order('total_score', { ascending: false })
      .order('created_at', { ascending: true });

    var players = playersRes.data || [];
    var me = players.find(function (p) { return p.id === state.playerId; });

    $('#ended-nickname').textContent = state.nickname;
    $('#ended-score').textContent = (me ? me.total_score : 0).toLocaleString('th-TH');

    var medals = ['🥇', '🥈', '🥉'];
    $('#ended-top3').innerHTML =
      '<ol class="top3">' +
      players
        .slice(0, 3)
        .map(function (p, i) {
          return (
            '<li><span>' + medals[i] + '</span><span>' + esc(p.nickname) + '</span>' +
            '<span class="score">' + p.total_score.toLocaleString('th-TH') + '</span></li>'
          );
        })
        .join('') +
      '</ol>';
  }

  /* =================================================== Bindings ========== */
  function bindEvents() {
    $('#join-form').addEventListener('submit', joinGame);

    $('#pad').addEventListener('click', function (event) {
      var btn = event.target.closest('.pad-btn');
      if (!btn) return;
      submitAnswer(parseInt(btn.dataset.option, 10));
    });

    // เติม PIN อัตโนมัติเมื่อวาง (Paste)
    $('#pin-input').addEventListener('input', function (event) {
      event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6);
    });

    window.addEventListener('beforeunload', unsubscribe);
  }

  init();
})();
