/**
 * ATHENA — หน้า Admin (admin.html)
 * เข้าสู่ระบบด้วย Username/Password ที่ "ตรวจในฐานข้อมูล" (bcrypt ผ่าน RPC `admin_login`)
 * การแก้ไข/ลบ ข้อมูลทุกครั้งแนบ token ชั่วคราว และ database เป็นผู้ตรวจซ้ำอีกชั้น
 */
(function () {
  'use strict';

  var A = window.Athena;
  var $ = A.$;
  var esc = A.esc;
  var TOKEN_KEY = 'athena_admin_token';

  if (!A.guard()) return;

  var client = null;
  var started = false;
  var quizzes = [];
  var questionCounts = {};
  var questions = [];
  var selectedQuizId = null;

  /* ---------------------------------------------------------- Session ---- */
  function getToken() {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch (e) {
      return null;
    }
  }

  function setToken(token) {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }

  /** เรียก RPC ที่ต้องใช้ token (ทุกการเขียนข้อมูล) */
  function adminCall(name, args) {
    var payload = args || {};
    payload.p_token = getToken();
    return client.rpc(name, payload);
  }

  /** ตรวจผลการเขียนข้อมูล — คืน true ถ้ามีข้อผิดพลาด (จัดการแจ้งเตือนแล้ว) */
  function writeError(res, fallback) {
    if (res.error) {
      if (/admin_/.test(res.error.message || '')) {
        forceLogout('รันไฟล์ sql/migrations/2026-11-02_admin_auth_database.sql ก่อน');
      } else {
        A.toast(A.errorMessage(res.error, fallback), 'error');
      }
      return true;
    }
    if (res.data && res.data.ok === false) {
      if (res.data.error === 'invalid_session') {
        forceLogout('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        return true;
      }
      var messages = {
        title_required: 'กรุณาใส่ชื่อชุดข้อสอบ',
        text_required: 'กรุณาใส่คำถาม',
        options_required: 'กรอกตัวเลือกให้ครบทั้ง 4 ข้อ',
        correct_required: 'เลือกข้อที่ถูกต้อง',
        not_found: 'ไม่พบข้อมูล',
        quiz_not_found: 'ไม่พบชุดข้อสอบ'
      };
      A.toast(messages[res.data.error] || fallback, 'error');
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------- Auth ---- */
  function showLogin() {
    $('#screen-login').hidden = false;
    $('#admin-app').hidden = true;
    $('#btn-logout').hidden = true;
    $('#login-username').focus();
  }

  function showApp() {
    $('#screen-login').hidden = true;
    $('#admin-app').hidden = false;
    $('#btn-logout').hidden = false;
  }

  async function handleLogin(event) {
    event.preventDefault();

    var username = $('#login-username').value.trim();
    var password = $('#login-password').value;
    var button = $('#login-form').querySelector('button[type="submit"]');

    button.disabled = true;
    try {
      var res = await client.rpc('admin_login', {
        p_username: username,
        p_password: password
      });

      if (res.error) {
        $('#login-error').hidden = false;
        $('#login-error').textContent =
          /admin_login/.test(res.error.message || '')
            ? 'ยังไม่ได้รันไฟล์ sql/migrations/2026-11-02_admin_auth_database.sql'
            : 'เข้าสู่ระบบไม่สำเร็จ';
        return;
      }

      if (!res.data || res.data.ok !== true) {
        $('#login-error').hidden = false;
        $('#login-error').textContent = 'Username หรือ Password ไม่ถูกต้อง';
        $('#login-password').value = '';
        $('#login-password').focus();
        A.buzz([60, 60, 60]);
        return;
      }

      setToken(res.data.token);
      $('#login-error').hidden = true;
      $('#login-form').reset();
      A.buzz(40);
      startApp();
    } catch (e) {
      $('#login-error').hidden = false;
      $('#login-error').textContent = 'เชื่อมต่อฐานข้อมูลไม่สำเร็จ';
    } finally {
      button.disabled = false;
    }
  }

  function forceLogout(message) {
    var token = getToken();
    if (token && client) client.rpc('admin_logout', { p_token: token });
    setToken(null);
    showLogin();
    if (message) A.toast(message, 'error');
  }

  async function restoreSession() {
    var token = getToken();
    if (!token) {
      showLogin();
      return;
    }
    try {
      var res = await client.rpc('admin_session_valid', { p_token: token });
      if (res.data === true) {
        startApp();
        return;
      }
    } catch (e) {}
    setToken(null);
    showLogin();
  }

  function startApp() {
    showApp();
    if (!started) {
      started = true;
      bindAppEvents();
    }
    loadQuizzes();
  }

  /* ---------------------------------------------------------- Quiz CRUD -- */
  async function loadQuizzes() {
    var res = await client
      .from('quizzes')
      .select('id, title, description, created_at')
      .order('created_at', { ascending: false });

    if (res.error) {
      A.toast(A.errorMessage(res.error, 'โหลดชุดข้อสอบไม่สำเร็จ'), 'error');
      return;
    }

    quizzes = res.data || [];
    renderQuizList();

    if (selectedQuizId && !quizzes.some(function (q) { return q.id === selectedQuizId; })) {
      selectedQuizId = null;
      renderQuestions();
    }
    loadQuestionCounts();
  }

  async function loadQuestionCounts() {
    var res = await client.from('questions').select('quiz_id');
    if (res.error) return;
    questionCounts = {};
    (res.data || []).forEach(function (row) {
      questionCounts[row.quiz_id] = (questionCounts[row.quiz_id] || 0) + 1;
    });
    renderQuizList();
  }

  function renderQuizList() {
    $('#quiz-empty').hidden = quizzes.length > 0;

    $('#quiz-list').innerHTML = quizzes
      .map(function (quiz) {
        var count = questionCounts[quiz.id] || 0;
        var selected = quiz.id === selectedQuizId ? ' is-selected' : '';
        return (
          '<li class="item' + selected + '" data-id="' + quiz.id + '">' +
            '<div class="item__main">' +
              '<div class="item__title">' + esc(quiz.title) + '</div>' +
              '<div class="item__meta">' + count + ' คำถาม</div>' +
            '</div>' +
            '<div class="item__actions">' +
              '<button class="btn btn-sm btn-primary" data-act="launch">▶ เริ่มเล่น</button>' +
              '<button class="btn btn-sm" data-act="edit">แก้ไข</button>' +
              '<button class="btn btn-sm btn-danger" data-act="delete">ลบ</button>' +
            '</div>' +
          '</li>'
        );
      })
      .join('');
  }

  function openQuizDialog(quiz) {
    $('#quiz-dialog-title').textContent = quiz ? 'แก้ไขชุดข้อสอบ' : 'ชุดข้อสอบใหม่';
    $('#quiz-id').value = quiz ? quiz.id : '';
    $('#quiz-title').value = quiz ? quiz.title : '';
    $('#quiz-description').value = quiz ? quiz.description || '' : '';
    $('#quiz-time-limit').value = String(defaultTimeLimit(quiz ? quiz.id : null));
    $('#quiz-points').value = String(defaultPoints(quiz ? quiz.id : null));
    $('#quiz-dialog').showModal();
    $('#quiz-title').focus();
  }

  async function saveQuiz(event) {
    event.preventDefault();
    var id = $('#quiz-id').value;

    var res = await adminCall('admin_save_quiz', {
      p_id: id || null,
      p_title: $('#quiz-title').value,
      p_description: $('#quiz-description').value
    });
    if (writeError(res, 'บันทึกไม่สำเร็จ')) return;

    var savedId = res.data.id;
    saveDefaultSettings(savedId, $('#quiz-time-limit').value, $('#quiz-points').value);

    $('#quiz-dialog').close();
    A.toast('บันทึกแล้ว', 'ok');
    await loadQuizzes();
    if (!id) selectQuiz(savedId);
  }

  async function deleteQuiz(id) {
    var quiz = quizzes.find(function (q) { return q.id === id; });
    if (!confirm('ลบ "' + (quiz ? quiz.title : '') + '" ?')) return;

    var res = await adminCall('admin_delete_quiz', { p_id: id });
    if (writeError(res, 'ลบไม่สำเร็จ')) return;

    A.toast('ลบแล้ว', 'ok');
    if (selectedQuizId === id) {
      selectedQuizId = null;
      renderQuestions();
    }
    await loadQuizzes();
  }

  /* ------------------------------------------------------ Question CRUD -- */
  async function selectQuiz(id) {
    selectedQuizId = id;
    renderQuizList();
    await loadQuestions();
  }

  async function loadQuestions() {
    if (!selectedQuizId) {
      renderQuestions();
      return;
    }

    var res = await client
      .from('questions')
      .select('id, question_text, options, correct_option, time_limit, points, order_index')
      .eq('quiz_id', selectedQuizId)
      .order('order_index', { ascending: true })
      .order('created_at', { ascending: true });

    if (res.error) {
      A.toast(A.errorMessage(res.error, 'โหลดคำถามไม่สำเร็จ'), 'error');
      return;
    }

    questions = res.data || [];
    renderQuestions();
  }

  function renderQuestions() {
    var quiz = quizzes.find(function (q) { return q.id === selectedQuizId; });
    var hasQuiz = !!quiz;

    $('#no-quiz-hint').hidden = hasQuiz;
    $('#btn-new-question').disabled = !hasQuiz;
    $('#questions-quiz-name').textContent = hasQuiz ? '· ' + quiz.title : '';
    $('#question-empty').hidden = !(hasQuiz && questions.length === 0);

    var letters = ['A', 'B', 'C', 'D'];
    $('#question-list').innerHTML = questions
      .map(function (q, i) {
        return (
          '<li class="item" data-id="' + q.id + '">' +
            '<div class="item__index">' + (i + 1) + '</div>' +
            '<div class="item__main">' +
              '<div class="item__title">' + esc(q.question_text) + '</div>' +
              '<div class="item__meta">เฉลย ' + letters[q.correct_option] +
                ' · ' + q.points + ' · ' + q.time_limit + ' วิ</div>' +
            '</div>' +
            '<div class="item__actions">' +
              '<button class="btn btn-sm" data-act="edit">แก้ไข</button>' +
              '<button class="btn btn-sm btn-danger" data-act="delete">ลบ</button>' +
            '</div>' +
          '</li>'
        );
      })
      .join('');
  }

  function openQuestionDialog(question) {
    if (!selectedQuizId) return;

    $('#question-dialog-title').textContent = question ? 'แก้ไขคำถาม' : 'คำถามใหม่';
    $('#question-id').value = question ? question.id : '';
    $('#question-text').value = question ? question.question_text : '';

    var options = (question && question.options) || ['', '', '', ''];
    for (var i = 0; i < 4; i++) $('#option-' + i).value = options[i] || '';

    var correct = question ? question.correct_option : 0;
    $('input[name="correct"][value="' + correct + '"]').checked = true;

    $('#question-points').value = String(question ? question.points : defaultPoints(selectedQuizId));
    $('#question-time-limit').value = String(question ? question.time_limit : defaultTimeLimit(selectedQuizId));
    $('#question-order').value = String(question ? question.order_index : questions.length);

    $('#question-dialog').showModal();
    $('#question-text').focus();
  }

  async function saveQuestion(event) {
    event.preventDefault();
    if (!selectedQuizId) return;

    var id = $('#question-id').value;
    var options = [0, 1, 2, 3].map(function (i) { return $('#option-' + i).value; });

    var res = await adminCall('admin_save_question', {
      p_id: id || null,
      p_quiz_id: selectedQuizId,
      p_question_text: $('#question-text').value,
      p_options: options,
      p_correct_option: parseInt($('input[name="correct"]:checked').value, 10),
      p_time_limit: parseInt($('#question-time-limit').value, 10),
      p_points: parseInt($('#question-points').value, 10),
      p_order_index: parseInt($('#question-order').value, 10)
    });
    if (writeError(res, 'บันทึกไม่สำเร็จ')) return;

    $('#question-dialog').close();
    A.toast('บันทึกแล้ว', 'ok');
    await loadQuestions();
    loadQuestionCounts();
  }

  async function deleteQuestion(id) {
    if (!confirm('ลบคำถามข้อนี้?')) return;

    var res = await adminCall('admin_delete_question', { p_id: id });
    if (writeError(res, 'ลบไม่สำเร็จ')) return;

    A.toast('ลบแล้ว', 'ok');
    await loadQuestions();
    loadQuestionCounts();
  }

  /* ------------------------------------- Default settings (localStorage) -- */
  function defaultTimeLimit(quizId) {
    var v = quizId ? localStorage.getItem('athena_time_' + quizId) : null;
    return v || String(A.CFG.DEFAULT_TIME_LIMIT || 20);
  }

  function defaultPoints(quizId) {
    var v = quizId ? localStorage.getItem('athena_points_' + quizId) : null;
    return v || String(A.CFG.DEFAULT_POINTS || 1000);
  }

  function saveDefaultSettings(quizId, timeLimit, points) {
    try {
      localStorage.setItem('athena_time_' + quizId, timeLimit);
      localStorage.setItem('athena_points_' + quizId, points);
    } catch (e) {}
  }

  /* ---------------------------------------------------------- Bindings --- */
  function bindAuthEvents() {
    $('#login-form').addEventListener('submit', handleLogin);
    $('#btn-logout').addEventListener('click', function () { forceLogout(null); });
  }

  function bindAppEvents() {
    $('#btn-new-quiz').addEventListener('click', function () { openQuizDialog(null); });
    $('#quiz-cancel').addEventListener('click', function () { $('#quiz-dialog').close(); });
    $('#quiz-form').addEventListener('submit', saveQuiz);

    $('#btn-new-question').addEventListener('click', function () { openQuestionDialog(null); });
    $('#question-cancel').addEventListener('click', function () { $('#question-dialog').close(); });
    $('#question-form').addEventListener('submit', saveQuestion);

    $('#quiz-list').addEventListener('click', function (event) {
      var item = event.target.closest('.item');
      if (!item) return;
      var id = item.dataset.id;
      var btn = event.target.closest('button');
      var act = btn ? btn.dataset.act : 'select';

      if (act === 'edit') {
        openQuizDialog(quizzes.find(function (q) { return q.id === id; }));
      } else if (act === 'delete') {
        deleteQuiz(id);
      } else if (act === 'launch') {
        location.href = 'host.html?quiz=' + encodeURIComponent(id);
      } else {
        selectQuiz(id);
      }
    });

    $('#question-list').addEventListener('click', function (event) {
      var item = event.target.closest('.item');
      if (!item) return;
      var btn = event.target.closest('button');
      if (!btn) return;
      var id = item.dataset.id;

      if (btn.dataset.act === 'edit') {
        openQuestionDialog(questions.find(function (q) { return q.id === id; }));
      } else if (btn.dataset.act === 'delete') {
        deleteQuestion(id);
      }
    });
  }

  /* ------------------------------------------------------------- Init ---- */
  bindAuthEvents();

  try {
    client = A.createClient();
  } catch (e) {
    A.toast(e.message, 'error');
    return;
  }

  restoreSession();
})();
