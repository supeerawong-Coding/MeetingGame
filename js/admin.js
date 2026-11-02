/**
 * ATHENA — หน้า Admin (admin.html)
 * เข้าสู่ระบบด้วย Username/Password -> จัดการชุดข้อสอบและโจทย์คำถาม
 */
(function () {
  'use strict';

  var A = window.Athena;
  var $ = A.$;
  var esc = A.esc;
  var AUTH_KEY = 'athena_admin_auth';

  if (!A.guard()) return;

  var client = null;
  var started = false;
  var quizzes = [];
  var questionCounts = {};
  var questions = [];
  var selectedQuizId = null;

  /* ======================================================== Auth ========= */
  function isAuthed() {
    try {
      return sessionStorage.getItem(AUTH_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

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

  function handleLogin(event) {
    event.preventDefault();
    var username = $('#login-username').value.trim();
    var password = $('#login-password').value;
    var cfg = A.CFG;

    if (username === cfg.ADMIN_USERNAME && password === cfg.ADMIN_PASSWORD) {
      try {
        sessionStorage.setItem(AUTH_KEY, '1');
      } catch (e) {}
      $('#login-error').hidden = true;
      $('#login-form').reset();
      startApp();
      A.buzz(40);
    } else {
      $('#login-error').hidden = false;
      $('#login-password').value = '';
      $('#login-password').focus();
      A.buzz([60, 60, 60]);
    }
  }

  function logout() {
    try {
      sessionStorage.removeItem(AUTH_KEY);
    } catch (e) {}
    location.reload();
  }

  function startApp() {
    showApp();
    if (started) return;

    try {
      client = A.createClient();
    } catch (e) {
      A.toast(e.message, 'error');
      return;
    }

    started = true;
    bindAppEvents();
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
    var payload = {
      title: $('#quiz-title').value.trim(),
      description: $('#quiz-description').value.trim() || null
    };

    if (!payload.title) return;

    var res;
    if (id) {
      res = await client.from('quizzes').update(payload).eq('id', id).select();
    } else {
      res = await client.from('quizzes').insert(payload).select();
    }

    if (res.error) {
      A.toast(A.errorMessage(res.error, 'บันทึกไม่สำเร็จ'), 'error');
      return;
    }

    var savedId = res.data[0].id;
    saveDefaultSettings(savedId, $('#quiz-time-limit').value, $('#quiz-points').value);

    $('#quiz-dialog').close();
    A.toast('บันทึกแล้ว', 'ok');
    await loadQuizzes();
    if (!id) selectQuiz(savedId);
  }

  async function deleteQuiz(id) {
    var quiz = quizzes.find(function (q) { return q.id === id; });
    if (!confirm('ลบ "' + (quiz ? quiz.title : '') + '" ?')) return;

    var res = await client.from('quizzes').delete().eq('id', id);
    if (res.error) {
      A.toast(A.errorMessage(res.error, 'ลบไม่สำเร็จ'), 'error');
      return;
    }

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
    var options = [0, 1, 2, 3].map(function (i) { return $('#option-' + i).value.trim(); });

    if (options.some(function (o) { return !o; })) {
      A.toast('กรอกตัวเลือกให้ครบ 4 ข้อ', 'error');
      return;
    }

    var payload = {
      quiz_id: selectedQuizId,
      question_text: $('#question-text').value.trim(),
      options: options,
      correct_option: parseInt($('input[name="correct"]:checked').value, 10),
      points: parseInt($('#question-points').value, 10) || 1000,
      time_limit: parseInt($('#question-time-limit').value, 10) || 20,
      order_index: parseInt($('#question-order').value, 10) || 0
    };

    if (!payload.question_text) return;

    var res;
    if (id) {
      res = await client.from('questions').update(payload).eq('id', id).select();
    } else {
      res = await client.from('questions').insert(payload).select();
    }

    if (res.error) {
      A.toast(A.errorMessage(res.error, 'บันทึกไม่สำเร็จ'), 'error');
      return;
    }

    $('#question-dialog').close();
    A.toast('บันทึกแล้ว', 'ok');
    await loadQuestions();
    loadQuestionCounts();
  }

  async function deleteQuestion(id) {
    if (!confirm('ลบคำถามข้อนี้?')) return;
    var res = await client.from('questions').delete().eq('id', id);
    if (res.error) {
      A.toast(A.errorMessage(res.error, 'ลบไม่สำเร็จ'), 'error');
      return;
    }
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
    $('#btn-logout').addEventListener('click', logout);
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
  if (isAuthed()) startApp();
  else showLogin();
})();
