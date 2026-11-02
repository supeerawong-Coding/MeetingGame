/**
 * ATHENA — หน้า Host / ผู้จัดงาน (host.html)
 * ทำหน้าที่เป็น "ตัวดำเนินเกม" (Game Controller) ทุกอย่าง:
 *   สร้างห้อง + QR -> Lobby -> โจทย์พร้อม Countdown -> ผล/กราฟ/Leaderboard -> จบเกม
 * ทุกการเปลี่ยนสถานะทำผ่าน UPDATE ตาราง `rooms` เพื่อให้หน้า Player สับตะไคร้ (subscribe) อยู่
 * เปลี่ยนหน้าจอทันทีแบบ Realtime
 */
(function () {
  'use strict';

  var A = window.Athena;
  var $ = A.$;
  var $$ = A.$$;
  var esc = A.esc;
  var LETTERS = ['A', 'B', 'C', 'D'];

  if (!A.guard()) return;

  var client = null;
  var state = {
    quizId: null,
    quiz: null,
    questions: [],
    roomId: null,
    room: null,
    pin: null,
    players: [],
    answered: 0,
    timer: null,
    left: 0,
    total: 0,
    channel: null,
    prevScores: {}
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
    updateMuteButton();

    var params = new URLSearchParams(location.search);
    var quizParam = params.get('quiz');

    // กู้ค่าห้องเดิมหลังจากกด F5 (Resume)
    var savedRoomId = sessionStorage.getItem('athena_host_room');
    if (savedRoomId) {
      var resumed = await resumeRoom(savedRoomId);
      if (resumed) return;
    }

    if (quizParam) {
      var ok = await loadQuiz(quizParam);
      if (ok) showCreateBox();
      return;
    }

    await showQuizPicker();
  }

  async function resumeRoom(roomId) {
    var res = await client
      .from('rooms')
      .select('id, room_code, quiz_id, status, current_question_index')
      .eq('id', roomId)
      .maybeSingle();

    if (res.error || !res.data) {
      sessionStorage.removeItem('athena_host_room');
      return false;
    }

    var room = res.data;
    var ok = await loadQuiz(room.quiz_id);
    if (!ok) {
      sessionStorage.removeItem('athena_host_room');
      return false;
    }

    state.roomId = room.id;
    state.room = room;
    state.pin = room.room_code;
    showScreen('lobby');
    $('#room-badge').hidden = false;
    $('#pin-text').textContent = state.pin;

    if (room.status === 'lobby') {
      enterLobby();
    } else if (room.status === 'playing') {
      subscribeRoomChannel();
      showQuestion(room.current_question_index);
    } else if (room.status === 'showing_result') {
      subscribeRoomChannel();
      renderQuestionShell(room.current_question_index);
      await showResult();
    } else if (room.status === 'ended') {
      subscribeRoomChannel();
      await showEnded();
    } else {
      enterLobby();
    }
    return true;
  }

  /* =================================================== Data loading ====== */
  async function loadQuiz(quizId) {
    var quizRes = await client.from('quizzes').select('id, title, description').eq('id', quizId).maybeSingle();
    if (quizRes.error || !quizRes.data) {
      A.toast('ไม่พบชุดข้อสอบนี้แล้ว', 'error');
      return false;
    }

    var qRes = await client
      .from('questions')
      .select('id, question_text, options, correct_option, time_limit, points, order_index')
      .eq('quiz_id', quizId)
      .order('order_index', { ascending: true })
      .order('created_at', { ascending: true });

    if (qRes.error) {
      A.toast(A.errorMessage(qRes.error, 'โหลดคำถามไม่สำเร็จ'), 'error');
      return false;
    }

    state.quizId = quizId;
    state.quiz = quizRes.data;
    state.questions = qRes.data || [];

    $('#quiz-badge').hidden = false;
    $('#quiz-badge').textContent = state.quiz.title;
    return true;
  }

  async function showQuizPicker() {
    showScreen('setup');
    $('#create-room-box').hidden = true;
    $('#quiz-picker').hidden = false;

    var res = await client.from('quizzes').select('id, title, description').order('created_at', { ascending: false });
    if (res.error) {
      A.toast(A.errorMessage(res.error, 'โหลดชุดข้อสอบไม่สำเร็จ'), 'error');
      return;
    }

    var quizzes = res.data || [];
    $('#quiz-picker-empty').hidden = quizzes.length > 0;
    $('#quiz-picker').innerHTML = quizzes
      .map(function (q) {
        var desc = q.description ? '<span>' + esc(q.description) + '</span>' : '';
        return '<button data-id="' + q.id + '"><b>' + esc(q.title) + '</b>' + desc + '</button>';
      })
      .join('');
  }

  async function showCreateBox() {
    showScreen('setup');
    $('#quiz-picker').hidden = true;
    $('#create-room-box').hidden = false;
    $('#picked-quiz-title').textContent = state.quiz.title;
    $('#picked-quiz-desc').textContent = state.quiz.description || 'ไม่มีคำอธิบาย';
  }

  /* ================================================= Room / Lobby ========= */
  async function createRoom() {
    if (!state.quizId) return;
    var btn = $('#btn-create-room');
    btn.disabled = true;
    btn.textContent = 'กำลังสร้างห้อง…';

    try {
      // สุ่ม PIN 6 หลักจนกว่าจะไม่ซ้ำกับห้องที่มีอยู่
      var pin = A.randomPin();
      for (var i = 0; i < 8; i++) {
        var check = await client
          .from('rooms')
          .select('id', { count: 'exact', head: true })
          .eq('room_code', pin);
        if (!check.error && (check.count || 0) === 0) break;
        pin = A.randomPin();
      }

      var res = await client
        .from('rooms')
        .insert({ room_code: pin, quiz_id: state.quizId, status: 'lobby', current_question_index: 0 })
        .select()
        .single();

      if (res.error) {
        A.toast(A.errorMessage(res.error, 'สร้างห้องไม่สำเร็จ'), 'error');
        return;
      }

      state.roomId = res.data.id;
      state.room = res.data;
      state.pin = res.data.room_code;
      state.prevScores = {};
      sessionStorage.setItem('athena_host_room', state.roomId);

      $('#room-badge').hidden = false;
      $('#pin-text').textContent = state.pin;

      enterLobby();
    } finally {
      btn.disabled = false;
      btn.textContent = 'สร้างห้องแข่งขัน';
    }
  }

  function enterLobby() {
    showScreen('lobby');
    $('#lobby-pin').textContent = state.pin;

    var url = A.playerUrl(state.pin);
    $('#join-url').textContent = url;

    // QR Code (ถ้าโหลดไลบรารีไม่ได้ จะแสดง URL แทน)
    var box = $('#qr-box');
    box.innerHTML = '';
    if (window.QRCode) {
      try {
        new QRCode(box, { text: url, width: 230, height: 230, correctLevel: QRCode.CorrectLevel.M });
      } catch (e) {
        box.innerHTML = '<a href="' + esc(url) + '">' + esc(url) + '</a>';
      }
    } else {
      box.innerHTML = '<a href="' + esc(url) + '">' + esc(url) + '</a>';
    }

    state.players = [];
    renderPlayers();
    subscribeRoomChannel();
    refreshPlayers();

    // ปุ่มเริ่มเกมต้องมีผู้เล่นอย่างน้อย 1 คน
    $('#btn-start').disabled = true;
    $('#lobby-waiting').textContent = 'รอผู้เล่นเข้าร่วม…';
  }

  async function refreshPlayers() {
    var res = await client
      .from('players')
      .select('id, nickname, total_score')
      .eq('room_id', state.roomId)
      .order('created_at', { ascending: true });

    if (res.error) return;
    state.players = res.data || [];
    renderPlayers();
    updateMeta();
  }

  function renderPlayers() {
    $('#lobby-count').textContent = state.players.length;
    $('#player-list').innerHTML = state.players
      .map(function (p) { return '<li>' + esc(p.nickname) + '</li>'; })
      .join('');

    var hasPlayers = state.players.length > 0;
    $('#btn-start').disabled = !hasPlayers;
    $('#lobby-waiting').hidden = hasPlayers;
  }

  /* ==================================================== Realtime ========= */
  /** Pub/Sub: ฟังเฉพาะแถวของห้องตัวเองเท่านั้น (ลดภาระ Database) */
  function subscribeRoomChannel() {
    unsubscribe();

    state.channel = client
      .channel('host-room-' + state.roomId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'players', filter: 'room_id=eq.' + state.roomId },
        function (payload) {
          if (!payload.new) return;
          var exists = state.players.some(function (p) { return p.id === payload.new.id; });
          if (!exists) {
            state.players.push(payload.new);
            renderPlayers();
            updateMeta();
            A.beep(880, 120);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'players', filter: 'room_id=eq.' + state.roomId },
        function () {
          if (currentScreen() === 'result' || currentScreen() === 'ended') refreshLeaderboard();
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'answers', filter: 'room_id=eq.' + state.roomId },
        function () {
          if (currentScreen() === 'question') refreshAnsweredCount();
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

  /* ==================================================== Screens ========== */
  function showScreen(name) {
    ['setup', 'lobby', 'question', 'result', 'ended'].forEach(function (s) {
      $('#screen-' + s).hidden = s !== name;
    });
    window.scrollTo(0, 0);
  }

  function currentScreen() {
    if (!$('#screen-setup').hidden) return 'setup';
    if (!$('#screen-lobby').hidden) return 'lobby';
    if (!$('#screen-question').hidden) return 'question';
    if (!$('#screen-result').hidden) return 'result';
    return 'ended';
  }

  /* ================================================= Game start ========== */
  async function startGame() {
    if (!state.players.length) return;

    var res = await client
      .from('rooms')
      .update({ status: 'playing', current_question_index: 0 })
      .eq('id', state.roomId)
      .select()
      .single();

    if (res.error) {
      A.toast(A.errorMessage(res.error, 'เริ่มเกมไม่สำเร็จ'), 'error');
      return;
    }

    state.room = res.data;
    A.beep(660, 150);
    A.beep(880, 200, 180);
    showQuestion(0);
  }

  /* ================================================= Question ============ */
  function renderQuestionShell(index) {
    var q = state.questions[index];
    if (!q) return null;

    showScreen('question');
    $('#q-counter').textContent = 'ข้อ ' + (index + 1) + '/' + state.questions.length;
    $('#q-text').textContent = q.question_text;

    $('#q-options').innerHTML = (q.options || [])
      .map(function (text, i) {
        return (
          '<div class="q-option q-option--' + i + '">' +
            '<span class="shape shape-' + ['triangle', 'diamond', 'circle', 'square'][i] + '"></span>' +
            '<span class="letter">' + LETTERS[i] + '</span>' +
            '<span>' + esc(text) + '</span>' +
          '</div>'
        );
      })
      .join('');

    var isLast = index >= state.questions.length - 1;
    $$('.js-next').forEach(function (btn) {
      btn.textContent = isLast ? 'จบเกม 🏁' : 'ข้อถัดไป →';
    });

    state.answered = 0;
    updateMeta();
    refreshAnsweredCount();
    return q;
  }

  function showQuestion(index) {
    var q = renderQuestionShell(index);
    if (!q) return;

    state.total = q.time_limit;
    state.left = q.time_limit;
    renderTimer();
    A.beep(700, 150);

    clearInterval(state.timer);
    state.timer = setInterval(tick, 1000);
  }

  function tick() {
    state.left -= 1;
    if (state.left <= 0) {
      state.left = 0;
      renderTimer();
      clearInterval(state.timer);
      state.timer = null;
      A.beep(440, 350);
      finishQuestion();
      return;
    }
    if (state.left <= 3) A.beep(880, 120);
    renderTimer();
  }

  function renderTimer() {
    var el = $('#q-timer');
    el.textContent = state.left;
    el.classList.toggle('is-urgent', state.left <= 3);
    var ratio = state.total ? state.left / state.total : 0;
    $('#q-progress-bar').style.transform = 'scaleX(' + ratio + ')';
  }

  function updateMeta() {
    $('#q-answered').textContent = 'ตอบแล้ว ' + state.answered + '/' + state.players.length;
  }

  async function refreshAnsweredCount() {
    var index = state.room ? state.room.current_question_index : 0;
    var q = state.questions[index];
    if (!q) return;

    var res = await client
      .from('answers')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', state.roomId)
      .eq('question_id', q.id);

    if (!res.error) {
      state.answered = res.count || 0;
      updateMeta();
    }
  }

  /** กดปุ่ม "จบข้อนี้" (หรือเวลาหมดเอง) -> แจ้งหน้า Player ให้โชว์ผล */
  async function finishQuestion() {
    clearInterval(state.timer);
    state.timer = null;

    var res = await client
      .from('rooms')
      .update({ status: 'showing_result' })
      .eq('id', state.roomId)
      .select()
      .single();

    if (res.error) {
      A.toast(A.errorMessage(res.error, 'ดำเนินการไม่สำเร็จ'), 'error');
      return;
    }
    state.room = res.data;
    await showResult();
  }

  /* =================================================== Result ============ */
  async function showResult() {
    var index = state.room.current_question_index;
    var q = state.questions[index];
    if (!q) return;

    showScreen('result');
    $('#r-counter').textContent = 'ข้อ ' + (index + 1) + '/' + state.questions.length;

    // ดึงคำตอบทั้งหมดของข้อนี้เพื่อทำกราฟแท่ง
    var res = await client
      .from('answers')
      .select('selected_option, is_correct, score_earned, player_id')
      .eq('room_id', state.roomId)
      .eq('question_id', q.id);

    var answers = res.data || [];
    var counts = [0, 0, 0, 0];
    answers.forEach(function (a) {
      if (counts[a.selected_option] !== undefined) counts[a.selected_option] += 1;
    });

    renderChart(counts, q.correct_option);
    renderReveal(q, answers);
    await refreshLeaderboard();
    A.beep(523, 150);
    A.beep(659, 150, 160);
    A.beep(784, 260, 320);
  }

  function renderChart(counts, correct) {
    var max = Math.max.apply(null, counts.concat([1]));
    $('#chart').innerHTML = counts
      .map(function (count, i) {
        var cls = i === correct ? ' is-correct' : '';
        return (
          '<div class="chart-col chart-col--' + i + cls + '">' +
            '<div class="chart-count">' + count + '</div>' +
            '<div class="chart-bar" style="height:0%"></div>' +
            '<div class="chart-label">' + LETTERS[i] + '</div>' +
          '</div>'
        );
      })
      .join('');

    // ค่อย ๆ ขยายความสูงของแท่ง (animation)
    requestAnimationFrame(function () {
      A.$$('#chart .chart-col').forEach(function (col, i) {
        var pct = Math.round((counts[i] / max) * 100);
        col.querySelector('.chart-bar').style.height = Math.max(pct, 4) + '%';
      });
    });
  }

  function renderReveal(q, answers) {
    var correctCount = answers.filter(function (a) { return a.is_correct; }).length;
    $('#reveal').innerHTML =
      'เฉลยข้อนี้: <span class="ok">' + LETTERS[q.correct_option] + '</span> — ' +
      esc((q.options || [])[q.correct_option] || '') +
      '<br><span class="muted">มี ' + correctCount + ' คนตอบถูก · ข้อนี้ ' + q.points + ' คะแนน</span>';
  }

  async function refreshLeaderboard() {
    var res = await client
      .from('players')
      .select('id, nickname, total_score')
      .eq('room_id', state.roomId)
      .order('total_score', { ascending: false })
      .order('created_at', { ascending: true });

    if (res.error) return;
    state.players = res.data || [];
    renderLeaderboard($('#leaderboard'), state.players.slice(0, 5));
  }

  function renderLeaderboard(container, players) {
    var html = players
      .map(function (p, i) {
        var prev = state.prevScores[p.id] !== undefined ? state.prevScores[p.id] : 0;
        return (
          '<li style="animation-delay:' + i * 60 + 'ms">' +
            '<span class="rank">' + (i + 1) + '</span>' +
            '<span class="name">' + esc(p.nickname) + '</span>' +
            '<span class="score" data-score="' + p.id + '" data-from="' + prev + '" data-to="' + p.total_score + '">0</span>' +
          '</li>'
        );
      })
      .join('');
    container.innerHTML = html;

    // Effect อัปเดตคะแนน (นับขึ้นไปยังค่าใหม่)
    A.$$('.score', container).forEach(function (el) {
      A.countUp(el, parseInt(el.dataset.from, 10) || 0, parseInt(el.dataset.to, 10) || 0, 800);
    });

    players.forEach(function (p) { state.prevScores[p.id] = p.total_score; });
  }

  /* ============================================ Next / End game ========== */
  async function nextQuestion() {
    var next = (state.room.current_question_index || 0) + 1;

    if (next >= state.questions.length) {
      await endGame();
      return;
    }

    var res = await client
      .from('rooms')
      .update({ status: 'playing', current_question_index: next })
      .eq('id', state.roomId)
      .select()
      .single();

    if (res.error) {
      A.toast(A.errorMessage(res.error, 'เปลี่ยนข้อไม่สำเร็จ'), 'error');
      return;
    }
    state.room = res.data;
    showQuestion(next);
  }

  async function endGame() {
    clearInterval(state.timer);
    state.timer = null;

    var res = await client
      .from('rooms')
      .update({ status: 'ended' })
      .eq('id', state.roomId)
      .select()
      .single();

    if (res.error) {
      A.toast(A.errorMessage(res.error, 'จบเกมไม่สำเร็จ'), 'error');
      return;
    }
    state.room = res.data;
    await showEnded();
  }

  async function showEnded() {
    await refreshLeaderboard();
    showScreen('ended');
    $('#ended-sub').textContent = 'ห้อง ' + state.pin + ' · ' + state.quiz.title;

    var top3 = state.players.slice(0, 3);
    var medals = ['🥇', '🥈', '🥉'];
    var order = [1, 0, 2]; // จัดลำดับโพเดียม 2-1-3

    $('#podium').innerHTML = order
      .filter(function (i) { return top3[i]; })
      .map(function (i) {
        return (
          '<div class="podium__item podium__item--' + (i + 1) + '">' +
            '<div class="medal">' + medals[i] + '</div>' +
            '<div class="name">' + esc(top3[i].nickname) + '</div>' +
            '<div class="score">' + top3[i].total_score.toLocaleString('th-TH') + '</div>' +
          '</div>'
        );
      })
      .join('');

    renderLeaderboard($('#final-board'), state.players.slice(0, 5));
    A.beep(523, 150); A.beep(659, 150, 170); A.beep(784, 150, 340); A.beep(1046, 400, 510);
  }

  function resetRoom() {
    clearInterval(state.timer);
    unsubscribe();
    sessionStorage.removeItem('athena_host_room');
    state.roomId = null;
    state.room = null;
    state.pin = null;
    state.players = [];
    $('#room-badge').hidden = true;
    location.href = 'host.html';
  }

  /* =================================================== Bindings ========== */
  function updateMuteButton() {
    $('#btn-mute').textContent = A.isMuted() ? '🔇 เสียง: ปิด' : '🔊 เสียง: เปิด';
  }

  function bindEvents() {
    $('#btn-create-room').addEventListener('click', createRoom);
    $('#btn-change-quiz').addEventListener('click', function () {
      state.quizId = null;
      sessionStorage.removeItem('athena_host_room');
      showQuizPicker();
    });
    $('#btn-start').addEventListener('click', startGame);

    $$('.js-next').forEach(function (btn) { btn.addEventListener('click', nextQuestion); });
    $$('.js-end').forEach(function (btn) { btn.addEventListener('click', endGame); });
    $$('.js-finish').forEach(function (btn) { btn.addEventListener('click', finishQuestion); });

    $('#btn-new-room').addEventListener('click', resetRoom);

    $('#btn-mute').addEventListener('click', function () {
      A.setMuted(!A.isMuted());
      updateMuteButton();
    });

    // เลือกชุดข้อสอบในหน้า Setup
    $('#quiz-picker').addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-id]');
      if (!btn) return;
      loadQuiz(btn.dataset.id).then(function (ok) {
        if (ok) showCreateBox();
      });
    });

    // ปิดแท็บ = ปิดห้อง
    window.addEventListener('beforeunload', function () {
      clearInterval(state.timer);
      unsubscribe();
    });
  }

  init();
})();
