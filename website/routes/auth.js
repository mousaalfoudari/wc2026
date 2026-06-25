'use strict';
const { layout, redirect, escapeHtml } = require('../lib/render');
const { sendHtml } = require('../lib/http');
const users = require('../lib/users');
const { makeSessionCookie, clearSessionCookie } = require('../lib/auth');

const LOGIN_BG = '/banner.jpg';

// Shows the "تكتكها" poster (trophy/ball/stadium + title) inside a fixed
// 700/480 box on the login/register pages — replaces the grass image that
// used to be here. The poster (700x933) is portrait while the box is
// landscape, so object-fit: contain keeps the whole poster visible (nothing
// cropped, including the team names at the bottom) instead of cover cutting
// most of it off. The grey background-color (sampled from the poster's own
// left/right edges) fills the leftover space on the sides instead of
// showing blank white.
function loginImageHtml() {
  return `<div class="max-w-sm mx-auto mt-2">
    <div class="w-full rounded-xl shadow-sm overflow-hidden flex items-center justify-center" style="aspect-ratio: 700 / 480; background-color: #8b9191;">
      <img src="${LOGIN_BG}" alt="" style="width: 100%; height: 100%; object-fit: contain; object-position: center;" />
    </div>
  </div>`;
}

function card(inner) {
  return `
    <div class="max-w-sm mx-auto mt-2">
      <div class="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">${inner}</div>
    </div>`;
}

function registerPage() {
  return loginImageHtml() + card(`
    <h1 class="text-xl font-bold text-emerald-700 mb-1">تسجيل مشترك جديد</h1>
    <p class="text-sm text-slate-500 mb-4">حط اسمك وكلمة مرور تخصك، وما يحق لغيرك يدخل على توقعك إلا بهذي البيانات.</p>
    <form method="post" action="/register" class="space-y-3">
      <div>
        <label class="block text-sm font-medium mb-1">الاسم</label>
        <input name="name" required maxlength="40" class="w-full border border-slate-300 rounded-lg px-3 py-2" placeholder="اسمك اللي يظهر بالترتيب" />
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">كلمة المرور</label>
        <input name="password" type="password" required minlength="4" class="w-full border border-slate-300 rounded-lg px-3 py-2" placeholder="٤ خانات أو أكثر" />
      </div>
      <button class="w-full bg-emerald-600 text-white rounded-lg py-2.5 font-bold hover:bg-emerald-700">تسجيل ودخول</button>
    </form>
    <p class="text-sm text-center text-slate-500 mt-4">عندك حساب؟ <a href="/login" class="text-emerald-700 font-medium">سجّل دخولك</a></p>
  `);
}

function loginPage() {
  return loginImageHtml() + card(`
    <h1 class="text-xl font-bold text-emerald-700 mb-1">تسجيل الدخول</h1>
    <form method="post" action="/login" class="space-y-3 mt-4">
      <div>
        <label class="block text-sm font-medium mb-1">الاسم</label>
        <input name="name" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">كلمة المرور</label>
        <input name="password" type="password" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
      </div>
      <button class="w-full bg-emerald-600 text-white rounded-lg py-2.5 font-bold hover:bg-emerald-700">دخول</button>
    </form>
    <p class="text-sm text-center text-slate-500 mt-4">مشترك جديد؟ <a href="/register" class="text-emerald-700 font-medium">سجّل من هنا</a></p>
  `);
}

module.exports = function (router) {
  router.get('/register', async (req, res) => {
    if (req.user) return redirect(res, '/predict');
    sendHtml(res, layout({ title: 'تسجيل جديد', user: null, body: registerPage(), msg: req.flashMsg, msgType: req.flashType }));
  });

  router.post('/register', async (req, res) => {
    const { name, password } = req.body;
    const result = users.createUser(name, password, false);
    if (!result.ok) {
      sendHtml(res, layout({ title: 'تسجيل جديد', user: null, body: registerPage(), msg: result.error, msgType: 'error' }));
      return;
    }
    res.setHeader('Set-Cookie', makeSessionCookie(result.id));
    redirect(res, '/predict', 'تم تسجيلك بنجاح، بالتوفيق! ⚽');
  });

  router.get('/login', async (req, res) => {
    if (req.user) return redirect(res, '/predict');
    sendHtml(res, layout({ title: 'تسجيل الدخول', user: null, body: loginPage(), msg: req.flashMsg, msgType: req.flashType }));
  });

  router.post('/login', async (req, res) => {
    const { name, password } = req.body;
    const result = users.checkLogin(name, password);
    if (!result.ok) {
      sendHtml(res, layout({ title: 'تسجيل الدخول', user: null, body: loginPage(), msg: result.error, msgType: 'error' }));
      return;
    }
    res.setHeader('Set-Cookie', makeSessionCookie(result.user.id));
    redirect(res, '/predict');
  });

  router.get('/logout', async (req, res) => {
    res.setHeader('Set-Cookie', clearSessionCookie());
    redirect(res, '/login');
  });
};
