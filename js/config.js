// הגדרות חיבור. כשהשדות ריקים המערכת עובדת במצב הדגמה (נתונים נשמרים רק בדפדפן הזה).
// אחרי הקמת Supabase: מדביקים כאן את כתובת הפרויקט (Project URL) ואת המפתח הציבורי (Publishable key או anon public).
// נמצאים ב-Supabase בהגדרות הפרויקט > מפתחות גישה (Project Settings > API Keys). לא להדביק את המפתח הסודי.
export const CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  // מזהה OAuth של Google (לא חובה, אפשר להזין גם במסך "תצוגה ומצב"). משמש לשליחת התראות במייל מה-Gmail.
  googleClientId: '',
  appName: 'גרושר · ניהול בטיחות באתר',
  // כתובת השולח בכל המיילים שהמערכת שולחת דרך Gmail. חייבת להיות מוגדרת ב-Gmail תחת "שליחת דואר בשם". ריק = כתובת ה-Gmail המחוברת
  mailFromName: '',
  mailFromEmail: ''
};
