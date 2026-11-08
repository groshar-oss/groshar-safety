// הגדרות חיבור. כשהשדות ריקים המערכת עובדת במצב הדגמה (נתונים נשמרים רק בדפדפן הזה).
// אחרי הקמת Supabase: מדביקים כאן את כתובת הפרויקט (Project URL) ואת המפתח הציבורי (Publishable key או anon public).
// נמצאים ב-Supabase בהגדרות הפרויקט > מפתחות גישה (Project Settings > API Keys). לא להדביק את המפתח הסודי.
export const CONFIG = {
  supabaseUrl: 'https://etzzkiusujebtpvzobnd.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0enpraXVzdWplYnRwdnpvYm5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNTQyMTUsImV4cCI6MjEwOTczMDIxNX0.3aK1kguIdxh7ybrzXTex_4YrEDxPjXqTARFuCnrI_CQ',
  // מזהה OAuth של Google (לא חובה, אפשר להזין גם במסך "תצוגה ומצב"). משמש לשליחת התראות במייל מה-Gmail.
  googleClientId: '',
  appName: 'גרושר · ניהול בטיחות באתר',
  // כתובת השולח בכל המיילים שהמערכת שולחת דרך Gmail. חייבת להיות מוגדרת ב-Gmail תחת "שליחת דואר בשם". ריק = כתובת ה-Gmail המחוברת
  mailFromName: '',
  mailFromEmail: ''
};
