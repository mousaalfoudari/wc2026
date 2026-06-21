(function () {
  var OTHER_VALUE = '__other__';
  var FIELD_CLASS = 'border border-slate-300 rounded-lg px-2 py-1 text-xs flex-1 min-w-[110px]';

  function textField(name, placeholder, value) {
    var el = document.createElement('input');
    el.type = 'text';
    el.name = name;
    el.placeholder = placeholder;
    el.className = FIELD_CLASS;
    el.value = value || '';
    return el;
  }

  // Builds a <select> of known players for one scorer slot, with an "other"
  // option that swaps itself for a free-text field (so an unlisted player —
  // e.g. a substitute not in the saved roster — can still be predicted).
  function playerSelect(name, placeholder, players, value) {
    // If the slot already holds a value that isn't in the roster (typed
    // before the roster existed, or picked "other" previously), keep it as
    // an editable text field instead of silently discarding it.
    if (value && players.indexOf(value) === -1) {
      return textField(name, placeholder, value);
    }
    var select = document.createElement('select');
    select.name = name;
    select.className = FIELD_CLASS + ' bg-white';

    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = placeholder + ' — اختر';
    select.appendChild(blank);

    players.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      select.appendChild(opt);
    });

    var other = document.createElement('option');
    other.value = OTHER_VALUE;
    other.textContent = '✏️ لاعب آخر (اكتب الاسم)';
    select.appendChild(other);

    select.value = value || '';
    return select;
  }

  function rebuild(input) {
    var n = Math.max(0, Math.min(20, parseInt(input.value, 10) || 0));
    var target = document.getElementById(input.dataset.target);
    if (!target) return;
    var existing = Array.prototype.slice.call(target.querySelectorAll('input, select')).map(function (i) {
      return i.value;
    });
    var players = null;
    if (input.dataset.players) {
      try {
        players = JSON.parse(input.dataset.players);
      } catch (e) {
        players = null;
      }
    }
    target.innerHTML = '';
    for (var i = 0; i < n; i++) {
      var placeholder = (input.dataset.team || 'هداف') + ' #' + (i + 1);
      var field =
        players && players.length
          ? playerSelect(input.dataset.field, placeholder, players, existing[i])
          : textField(input.dataset.field, placeholder, existing[i]);
      target.appendChild(field);
    }
  }

  document.addEventListener('input', function (e) {
    if (e.target.classList && e.target.classList.contains('score-input')) {
      rebuild(e.target);
    }
  });

  // "لاعب آخر" chosen in a generated dropdown: swap it for a free-text field.
  document.addEventListener('change', function (e) {
    if (e.target.tagName === 'SELECT' && e.target.value === OTHER_VALUE) {
      var replacement = textField(e.target.name, 'اكتب اسم اللاعب', '');
      e.target.parentNode.replaceChild(replacement, e.target);
      replacement.focus();
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
