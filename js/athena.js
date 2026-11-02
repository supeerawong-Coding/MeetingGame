/**
 * ATHENA — ฟังก์ชันส่วนกลาง (Shared Helpers)
 * หน้า admin.html / host.html / player.html ใช้ร่วมกันทั้งหมด
 */
(function () {
  'use strict';

  var CFG = window.ATHENA_CONFIG || {};

  /* ---------------------------------------------------------------- DOM --- */
  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  /** หนีอักขระป้องกัน XSS — ใช้กับข้อความที่มาจากฐานข้อมูล/ผู้เล่นเสมอ */
  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---------------------------------------------------------- Supabase --- */
  function isConfigured() {
    var url = String(CFG.SUPABASE_URL || '');
    var key = String(CFG.SUPABASE_ANON_KEY || '');
    return (
      url.indexOf('YOUR_PROJECT') === -1 &&
      url.indexOf('supabase.co') !== -1 &&
      key.length > 20 &&
      key.indexOf('YOUR_ANON') === -1
    );
  }

  function createClient() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('โหลดไลบรารี Supabase จาก CDN ไม่สำเร็จ (ตรวจสอบอินเทอร์เน็ต)');
    }
    if (!isConfigured()) {
      throw new Error('ยังตั้งค่า js/config.js ไม่เรียบร้อย');
    }
    return window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } }
    });
  }

  /** ถ้ายังไม่ได้ตั้งค่า config -> แสดงคำแนะนำทับหน้าจอ และคืน false */
  function guard() {
    if (isConfigured()) return true;
    var box = document.createElement('div');
    box.className = 'setup-notice';
    box.innerHTML =
      '<div class="setup-notice__box">' +
      '<h2>ตั้งค่า Supabase ก่อนใช้งาน</h2>' +
      '<ol>' +
      '<li>รัน <code>sql/schema.sql</code></li>' +
      '<li>ตั้งค่า <code>js/config.js</code></li>' +
      '</ol>' +
      '</div>';
    document.body.appendChild(box);
    return false;
  }

  /* -------------------------------------------------------------- UI ------ */
  var toastHost = null;

  /** แสดงข้อความแจ้งเตัว (Toast) มุมล่างหน้าจอ */
  function toast(message, type) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.id = 'toast-host';
      document.body.appendChild(toastHost);
    }
    var el = document.createElement('div');
    el.className = 'toast toast--' + (type || 'info');
    el.textContent = String(message);
    toastHost.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () {
        el.remove();
      }, 320);
    }, 3200);
  }

  /** สั่งสั่น (Web Vibration API) — ใช้บนมือถือ */
  function buzz(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) {
      /* ไม่รองรับก็ข้าม */
    }
  }

  /* ------------------------------------------------------------- Sound ---- */
  var audioCtx = null;
  var muted = false;

  function beep(freq, durationMs, delayMs, volume) {
    if (muted) return;
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtx) audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var start = audioCtx.currentTime + (delayMs || 0) / 1000;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq || 660;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume || 0.15, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + (durationMs || 150) / 1000);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + (durationMs || 150) / 1000 + 0.02);
    } catch (e) {
      /* เบราว์เซอร์บล็อกเสียงก็ข้าม */
    }
  }

  function setMuted(value) {
    muted = !!value;
    try {
      sessionStorage.setItem('athena_muted', muted ? '1' : '0');
    } catch (e) {}
    return muted;
  }

  try {
    muted = sessionStorage.getItem('athena_muted') === '1';
  } catch (e) {}

  /* ------------------------------------------------------------ Utils ----- */
  /** สุ่มรหัสห้อง 6 หลัก (100000-999999) */
  function randomPin() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  /** URL สำหรับให้ผู้เล่นเข้าร่วม (ใช้ตอนสร้าง QR Code และแสดงบนจอ Host) */
  function playerUrl(pin) {
    var base = String(CFG.APP_BASE_URL || '').trim();
    if (base) {
      return base.replace(/\/+$/, '') + '/player.html?pin=' + encodeURIComponent(pin);
    }
    return new URL('player.html', location.href).toString() + '?pin=' + encodeURIComponent(pin);
  }

  /** แปลงวินาทีเป็นข้อความ mm:ss */
  function mmss(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }

  /** คืนค่า error message ภาษาไทยจาก Supabase error */
  function errorMessage(error, fallback) {
    if (!error) return fallback || 'เกิดข้อผิดพลาด';
    if (error.code === 'PGRST116') return fallback || 'ไม่พบข้อมูลที่ต้องการ';
    return error.message || fallback || 'เกิดข้อผิดพลาด';
  }

  /**
   * นับคะแนนจาก -> ถึง (Animation)
   * กันบั๊คค่าค้างที่ 0: ถ้าแท็บไม่ได้แสดงผลหรือหน้าต่างไม่ถูกวาด
   * requestAnimationFrame จะไม่ทำงานเลย จึงต้องมี fallback แสดงค่าจริง
   */
  function countUp(element, from, to, durationMs) {
    var target = Number(to || 0).toLocaleString('th-TH');
    var finished = false;
    var frames = 0;
    var dur = durationMs || 700;

    function finish() {
      if (!finished) {
        finished = true;
        element.textContent = target;
      }
    }

    if (document.hidden || element.offsetParent === null) {
      finish();
      return;
    }

    var start = null;

    function step(ts) {
      if (finished) return;
      if (start === null) start = ts;
      frames += 1;
      var p = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      element.textContent = Math.round(from + (to - from) * eased).toLocaleString('th-TH');
      if (p >= 1) {
        finished = true;
        return;
      }
      requestAnimationFrame(step);
    }

    requestAnimationFrame(step);

    // ถ้า rAF ไม่ถูกเรียกเลยภายใน 300 มิลลิวินาที -> แสดงค่าจริงทันที
    setTimeout(function () {
      if (!finished && frames === 0) finish();
    }, 300);

    // สำรองรอบสุดท้าย: ต้องแสดงค่าจริงภายใน duration + 500 มิลลิวินาทีเสมอ
    setTimeout(finish, dur + 500);
  }

  window.Athena = {
    $: $,
    $$: $$,
    esc: esc,
    CFG: CFG,
    isConfigured: isConfigured,
    createClient: createClient,
    guard: guard,
    toast: toast,
    buzz: buzz,
    beep: beep,
    setMuted: setMuted,
    isMuted: function () {
      return muted;
    },
    randomPin: randomPin,
    playerUrl: playerUrl,
    mmss: mmss,
    errorMessage: errorMessage,
    countUp: countUp
  };
})();
