'use strict';

// English name (exactly as it appears in the openfootball/worldcup.json feed)
// -> Arabic display name. Used both when seeding the schedule and when
// matching live results back to our stored matches, so both sides always
// go through this same table.
const TEAMS_AR = {
  Mexico: 'المكسيك',
  'South Africa': 'جنوب أفريقيا',
  'South Korea': 'كوريا الجنوبية',
  'Czech Republic': 'التشيك',
  Canada: 'كندا',
  'Bosnia & Herzegovina': 'البوسنة والهرسك',
  Qatar: 'قطر',
  Switzerland: 'سويسرا',
  Brazil: 'البرازيل',
  Morocco: 'المغرب',
  Haiti: 'هايتي',
  Scotland: 'اسكتلندا',
  USA: 'الولايات المتحدة',
  Paraguay: 'باراغواي',
  Australia: 'أستراليا',
  Turkey: 'تركيا',
  Germany: 'ألمانيا',
  'Curaçao': 'كوراساو',
  'Ivory Coast': 'ساحل العاج',
  Ecuador: 'الإكوادور',
  Netherlands: 'هولندا',
  Japan: 'اليابان',
  Sweden: 'السويد',
  Tunisia: 'تونس',
  Belgium: 'بلجيكا',
  Egypt: 'مصر',
  Iran: 'إيران',
  'New Zealand': 'نيوزيلندا',
  Spain: 'إسبانيا',
  'Cape Verde': 'الرأس الأخضر',
  'Saudi Arabia': 'السعودية',
  Uruguay: 'الأوروغواي',
  France: 'فرنسا',
  Senegal: 'السنغال',
  Iraq: 'العراق',
  Norway: 'النرويج',
  Argentina: 'الأرجنتين',
  Algeria: 'الجزائر',
  Austria: 'النمسا',
  Jordan: 'الأردن',
  Portugal: 'البرتغال',
  'DR Congo': 'الكونغو الديمقراطية',
  Uzbekistan: 'أوزبكستان',
  Colombia: 'كولومبيا',
  England: 'إنجلترا',
  Croatia: 'كرواتيا',
  Ghana: 'غانا',
  Panama: 'بنما',
};

// Falls back to the original (English) name for anything not in the table
// (e.g. knockout-stage placeholders like "2A" or "W74").
function teamAr(englishName) {
  return TEAMS_AR[englishName] || englishName;
}

module.exports = { TEAMS_AR, teamAr };
