(function () {
  function rebuild(input) {
    var n = Math.max(0, Math.min(20, parseInt(input.value, 10) || 0));
    var target = document.getElementById(input.dataset.target);
    if (!target) return;
    var existing = Array.prototype.slice.call(target.querySelectorAll('input')).map(function (i) {
      return i.value;
    });
    target.innerHTML = '';
    for (var i = 0; i < n; i++) {
      var wrap = document.createElement('input');
      wrap.type = 'text';
      wrap.name = input.dataset.field;
      wrap.placeholder = (input.dataset.team || 'هداف') + ' #' + (i + 1);
      wrap.className = 'border border-slate-300 rounded-lg px-2 py-1 text-xs flex-1 min-w-[110px]';
      wrap.value = existing[i] || '';
      target.appendChild(wrap);
    }
  }

  document.addEventListener('input', function (e) {
    if (e.target.classList && e.target.classList.contains('score-input')) {
      rebuild(e.target);
    }
  });

  // Build scorer inputs for any pre-filled values on page load (e.g. validation re-render).
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.score-input').forEach(function (input) {
      if (input.value) rebuild(input);
    });
  });

  // Confirm before submitting a prediction, since it can't be edited afterwards.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.matches && form.matches('form[action^="/predict/match/"]')) {
      var ok = window.confirm('تأكيد إرسال التوقع؟ لا يمكنك تعديله بعد الإرسال.');
      if (!ok) e.preventDefault();
    }
    if (form.dataset && form.dataset.confirm) {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    }
  });

  // Admin "كل التوقعات" page: clicking a participant's name toggles their
  // prediction detail open/closed, so the page starts as names-only.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.pred-toggle-btn');
    if (!btn) return;
    var target = document.getElementById(btn.dataset.target);
    if (!target) return;
    target.classList.toggle('hidden');
  });
})();
