/**
 * ATHENA — หน้า Admin (admin.html)
 * จัดการคลังชุดข้อสอบ + โจทย์คำถาม ทั้ง เพิ่ม / แก้ไข / ลบ / เริ่มเล่น
 */
(function () {
  'use strict';

  var A = window.Athena;
  var $ = A.$;
  var esc = A.esc;

  if (!A.guard()) return;

  var client;
  var quizzes = [];
  var questionCounts = {};
  var questions = [];
  var selectedQuizId = null;

  /* ------------------------------------------------------------ init ----- */
  function init() {
    try {
      client = A.createClient();
    } catch (e) {
      A.toast(e.message, 'error');
      return;
    }
    bindEvents();
    loadQuizzes();
  }

  /* --------------------------------------------------------- Quiz CRUD --- */
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

  /** นับจำนวนคำถามของทุกชุด (ครั้งเดียว) เพื่อแสดงในลิสต์ */
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
    var list = $('#quiz-list');
    $('#quiz-empty').hidden = quizzes.length > 0;

    list.innerHTML = quizzes
      .map(function (quiz) {
        var count = questionCounts[quiz.id] || 0;
        var selected = quiz.id === selectedQuizId ? ' is-selected' : '';
        var desc = quiz.description
          ? '<div class="quiz-item__meta">' + esc(quiz.description) + '</div>'
          : '';
        return (
          '<li class="quiz-item' + selected + '" data-id="' + quiz.id + '">' +
            '<div class="quiz-item__main">' +
              '<div class="quiz-item__title">' + esc(quiz.title) + '</div>' +
              '<div class="quiz-item__meta">' + count + ' คำถาม</div>' +
              desc +
            '</div>' +
            '<div class="quiz-item__actions">' +
              '<button class="btn btn-sm btn-primary" data-act="launch">▶ เริ่มเล่น</button>' +
              '<button class="btn btn-sm" data-act="edit">แก้ไข</button>' +
              '<button class="btn btn-sm btn-danger" data-act="delete">ลบ</button>' +
            '</div>' +
          '</li>'
        );
      })
      .join('');
  }

  function openQuizForm(quiz) {
    var form = $('#quiz-form');
    form.hidden = false;
    $('#quiz-id').value = quiz ? quiz.id : '';
    $('#quiz-title').value = quiz ? quiz.title : '';
    $('#quiz-description').value = quiz ? quiz.description || '' : '';
    $('#quiz-time-limit').value = String(defaultTimeLimit(quiz ? quiz.id : null));
    $('#quiz-points').value = String(defaultPoints(quiz ? quiz.id : null));
    $('#quiz-title').focus();
  }

  function closeQuizForm() {
    $('#quiz-form').hidden = true;
    $('#quiz-form').reset();
    $('#quiz-id').value = '';
  }

  async function saveQuiz(event) {
    event.preventDefault();
    var id = $('#quiz-id').value;
    var payload = {
      title: $('#quiz-title').value.trim(),
      description: $('#quiz-description').value.trim() || null
    };

    if (!payload.title) {
      A.toast('กรุณาใส่ชื่อชุดข้อสอบ', 'error');
      return;
    }

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
    // เก็บค่าเวลา/คะแนนเริ่มต้นของชุดนี้ไว้ใช้ตอนสร้างคำถามใหม่
    saveDefaultSettings(savedId, $('#quiz-time-limit').value, $('#quiz-points').value);

    A.toast(id ? 'แก้ไขชุดข้อสอบแล้ว' : 'สร้างชุดข้อสอบแล้ว', 'ok');
    closeQuizForm();
    await loadQuizzes();
    if (!id) selectQuiz(savedId);
  }

  async function deleteQuiz(id) {
    var quiz = quizzes.find(function (q) { return q.id === id; });
    if (!confirm('ลบชุดข้อสอบ "' + (quiz ? quiz.title : '') + '" ?\nคำถามทั้งหมดในชุดจะถูกลบตามด้วย')) return;

    var res = await client.from('quizzes').delete().eq('id', id);
    if (res.error) {
      A.toast(A.errorMessage(res.error, 'ลบไม่สำเร็จ'), 'error');
      return;
    }
    A.toast('ลบชุดข้อสอบแล้ว', 'ok');
    if (selectedQuizId === id) {
      selectedQuizId = null;
      renderQuestions();
    }
    await loadQuizzes();
  }

  /* ---------------------------------------------------- Question CRUD ---- */
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

    $('#question-list').innerHTML = questions
      .map(function (q, i) {
        var letters = ['A', 'B', 'C', 'D'];
        return (
          '<li class="question-item is-correct" data-id="' + q.id + '">' +
            '<div class="question-item__index">' + (i + 1) + '</div>' +
            '<div class="question-item__main">' +
              '<div class="question-item__text">' + esc(q.question_text) + '</div>' +
              '<div class="question-item__meta">เฉลย ' +
                letters[q.correct_option] + ' · ' + q.points + ' คะแนน · ' + q.time_limit + ' วินาที</div>' +
            '</div>' +
            '<div class="question-item__actions">' +
              '<button class="btn btn-sm" data-act="edit">แก้ไข</button>' +
              '<button class="btn btn-sm btn-danger" data-act="delete">ลบ</button>' +
            '</div>' +
          '</li>'
        );
      })
      .join('');
  }

  function openQuestionForm(question) {
    if (!selectedQuizId) return;
    var form = $('#question-form');
    form.hidden = false;

    $('#question-id').value = question ? question.id : '';
    $('#question-text').value = question ? question.question_text : '';
    var options = (question && question.options) || ['', '', '', ''];
    for (var i = 0; i < 4; i++) {
      $('#option-' + i).value = options[i] || '';
    }
    var correct = question ? question.correct_option : 0;
    $('input[name="correct"][value="' + correct + '"]').checked = true;

    $('#question-points').value = String(question ? question.points : defaultPoints(selectedQuizId));
    $('#question-time-limit').value = String(question ? question.time_limit : defaultTimeLimit(selectedQuizId));
    $('#question-order').value = String(question ? question.order_index : questions.length);

    $('#question-text').focus();
  }

  function closeQuestionForm() {
    $('#question-form').hidden = true;
    $('#question-form').reset();
    $('#question-id').value = '';
  }

  async function saveQuestion(event) {
    event.preventDefault();
    if (!selectedQuizId) return;

    var id = $('#question-id').value;
    var options = [0, 1, 2, 3].map(function (i) {
      return $('#option-' + i).value.trim();
    });

    if (options.some(function (o) { return !o; })) {
      A.toast('กรุณากรอกตัวเลือกให้ครบทั้ง 4 ข้อ', 'error');
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

    if (!payload.question_text) {
      A.toast('กรุณาใส่ข้อความคำถาม', 'error');
      return;
    }

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

    A.toast(id ? 'แก้ไขคำถามแล้ว' : 'เพิ่มคำถามแล้ว', 'ok');
    closeQuestionForm();
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
    A.toast('ลบคำถามแล้ว', 'ok');
    await loadQuestions();
    loadQuestionCounts();
  }

  /* ----------------------------------------- Default settings (localStorage) */
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

  /* --------------------------------------------------------- Bindings ---- */
  function bindEvents() {
    $('#btn-new-quiz').addEventListener('click', function () { openQuizForm(null); });
    $('#quiz-cancel').addEventListener('click', closeQuizForm);
    $('#quiz-form').addEventListener('submit', saveQuiz);

    $('#btn-new-question').addEventListener('click', function () { openQuestionForm(null); });
    $('#question-cancel').addEventListener('click', closeQuestionForm);
    $('#question-form').addEventListener('submit', saveQuestion);

    // รายการชุดข้อสอบ (event delegation)
    $('#quiz-list').addEventListener('click', function (event) {
      var item = event.target.closest('.quiz-item');
      if (!item) return;
      var id = item.dataset.id;
      var btn = event.target.closest('button');
      var act = btn ? btn.dataset.act : 'select';

      if (act === 'edit') {
        var quiz = quizzes.find(function (q) { return q.id === id; });
        openQuizForm(quiz);
      } else if (act === 'delete') {
        deleteQuiz(id);
      } else if (act === 'launch') {
        // เริ่มเล่น -> เปิดหน้า Host เพื่อสร้างห้องทันที
        location.href = 'host.html?quiz=' + encodeURIComponent(id);
      } else {
        selectQuiz(id);
      }
    });

    // รายการคำถาม
    $('#question-list').addEventListener('click', function (event) {
      var item = event.target.closest('.question-item');
      if (!item) return;
      var id = item.dataset.id;
      var btn = event.target.closest('button');
      if (!btn) return;

      if (btn.dataset.act === 'edit') {
        var question = questions.find(function (q) { return q.id === id; });
        openQuestionForm(question);
      } else if (btn.dataset.act === 'delete') {
        deleteQuestion(id);
      }
    });
  }

  init();
})();
