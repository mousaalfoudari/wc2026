'use strict';

// يطبّق قوائم لاعبي الـ٤٨ فريق (ملف rosters.json بهذا المجلد) على موقعك المباشر،
// عن طريق تسجيل دخول كأدمن ثم إرسال كل قائمة لمسار /admin/rosters — تماماً كأنك
// تعبّيها بنفسك يدوياً بالنموذج، بس دفعة واحدة للـ٤٨ فريق.
//
// بياناتك (اسم وكلمة مرور الأدمن) ما تُكتب أبداً بهذا الملف ولا تُرسل لأي طرف
// إلا موقعك نفسه. تدخلها وقت التشغيل فقط، بطرفيتك أنت.
//
// التشغيل (من داخل مجلد website):
//   ADMIN_NAME="اسم الأدمن" ADMIN_PASSWORD="كلمة المرور" node scripts/apply_rosters.js
//
// تقدر كذا تحدد رابط الموقع لو مختلف (افتراضياً الموقع المباشر بالـ Render):
//   BASE_URL="https://your-site.onrender.com" ADMIN_NAME=... ADMIN_PASSWORD=... node scripts/apply_rosters.js
//
// يحتاج Node 22.5+ (نفس متطلبات تشغيل الموقع، fetch مدمج بدون أي اعتمادية خارجية).

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const BASE_URL = (process.env.BASE_URL || 'https://wc26-by9p.onrender.com').replace(/\/$/, '');
const ROSTERS_PATH = path.join(__dirname, 'rosters.json');

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function flashType(location) {
  try {
    const url = new URL(location, BASE_URL);
    return url.searchParams.get('t') || 'ok';
  } catch (e) {
    return 'ok';
  }
}

async function login(name, password) {
  const res = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `name=${encodeURIComponent(name)}&password=${encodeURIComponent(password)}`,
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  if (res.status !== 302 || !setCookie.length) {
    return { ok: false, error: 'الاسم أو كلمة المرور غلط (الموقع رجّع صفحة الدخول، مو تحويل لنجاح).' };
  }
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  return { ok: true, cookie };
}

async function saveRoster(cookie, teamName, players) {
  const body = `team_name=${encodeURIComponent(teamName)}&players=${encodeURIComponent(players.join('\n'))}`;
  const res = await fetch(`${BASE_URL}/admin/rosters`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body,
  });
  const location = res.headers.get('location') || '';
  if (res.status !== 302) {
    return { ok: false, error: `استجابة غير متوقعة (status ${res.status}) — تأكد إن حسابك أدمن.` };
  }
  if (location.includes('/login')) {
    return { ok: false, error: 'الجلسة رجعت لصفحة الدخول — يبدو إن الحساب مش أدمن أو الجلسة انتهت.' };
  }
  if (flashType(location) === 'error') {
    return { ok: false, error: 'الموقع رجّع رسالة خطأ (شيك من /admin/rosters يدوياً).' };
  }
  return { ok: true };
}

async function main() {
  if (!fs.existsSync(ROSTERS_PATH)) {
    console.error(`ملف القوائم غير موجود: ${ROSTERS_PATH}`);
    process.exit(1);
  }
  const rosters = JSON.parse(fs.readFileSync(ROSTERS_PATH, 'utf8'));
  const teams = Object.keys(rosters);
  console.log(`الموقع المستهدف: ${BASE_URL}`);
  console.log(`عدد الفرق بالملف: ${teams.length}\n`);

  const name = process.env.ADMIN_NAME || (await ask('اسم حساب الأدمن: '));
  const password = process.env.ADMIN_PASSWORD || (await ask('كلمة مرور الأدمن: '));

  console.log('\nتسجيل الدخول...');
  const loginResult = await login(name, password);
  if (!loginResult.ok) {
    console.error(`فشل تسجيل الدخول: ${loginResult.error}`);
    process.exit(1);
  }
  console.log('تم تسجيل الدخول ✅\n');

  let okCount = 0;
  const failed = [];
  for (const team of teams) {
    const players = rosters[team];
    process.stdout.write(`${team} (${players.length} لاعب)... `);
    const result = await saveRoster(loginResult.cookie, team, players);
    if (result.ok) {
      console.log('تم ✅');
      okCount += 1;
    } else {
      console.log(`فشل ❌ — ${result.error}`);
      failed.push(team);
    }
  }

  console.log(`\nالنتيجة: ${okCount} من ${teams.length} فريق تم حفظه بنجاح.`);
  if (failed.length) {
    console.log('الفرق اللي فشلت:', failed.join('، '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('خطأ غير متوقع:', err);
  process.exit(1);
});
