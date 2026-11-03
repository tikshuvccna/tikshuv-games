export type NodeKind = 'pc' | 'server' | 'printer' | 'hub' | 'switch';

export interface NodeDef { id: string; kind: NodeKind; x: number; y: number; label: string; appearAt: number }

export interface CutDef {
  at: number;
  /** Cut a random working link that touches this node; omit for any working link. */
  near?: string;
}

export interface CheckQuestion { q: string; options: string[]; correct: number; explain: string }

export interface LevelDef {
  id: string;
  title: string;
  topology: string;
  intro: string[];
  goal: string;
  nodes: NodeDef[];
  budget: number;
  duration: number;
  /** Mean seconds between packets from each computer. */
  spawnEvery: number;
  /** Seconds a packet may stay in the network before it counts as lost. */
  patience: number;
  /** Cost to turn a hub into a switch; null = not available in this level. */
  upgradeCost: number | null;
  cuts: CutDef[];
  /** Delivery ratios for 1, 2 and 3 stars. */
  stars: [number, number, number];
  check: CheckQuestion;
  takeaway: string;
}

export const WORLD = { w: 960, h: 600 } as const;

export const LEVELS: LevelDef[] = [
  {
    id: 'hub',
    title: 'כוכב פיזי, אפיק לוגי',
    topology: 'רכזת (Hub)',
    intro: [
      'כיתה חדשה צריכה רשת. כל המחשבים צריכים לדבר עם השרת.',
      'חברו כל מחשב לרכזת ואת הרכזת לשרת: גררו כבל מהתקן להתקן.',
      'שימו לב: הרכזת שולחת כל הודעה לכל הפורטים, וכולם חולקים "קו אחד". כששני מחשבים שולחים יחד, יש התנגשות.',
    ],
    goal: 'העבירו הודעות לשרת. מחשבים חדשים מתחברים במהלך הסבב.',
    nodes: [
      { id: 'S', kind: 'server', x: 480, y: 95, label: 'שרת', appearAt: 0 },
      { id: 'H', kind: 'hub', x: 480, y: 300, label: 'רכזת', appearAt: 0 },
      { id: 'P1', kind: 'pc', x: 190, y: 270, label: 'מחשב 1', appearAt: 0 },
      { id: 'P2', kind: 'pc', x: 770, y: 270, label: 'מחשב 2', appearAt: 0 },
      { id: 'P3', kind: 'pc', x: 250, y: 500, label: 'מחשב 3', appearAt: 10 },
      { id: 'P4', kind: 'pc', x: 710, y: 500, label: 'מחשב 4', appearAt: 22 },
      { id: 'P5', kind: 'pc', x: 480, y: 530, label: 'מחשב 5', appearAt: 34 },
    ],
    budget: 70,
    duration: 70,
    spawnEvery: 11,
    patience: 12,
    upgradeCost: null,
    cuts: [],
    stars: [0.5, 0.7, 0.85],
    check: {
      q: 'מה עושה רכזת (Hub) עם הודעה שהגיעה לאחד הפורטים שלה?',
      options: ['שולחת אותה רק ליעד', 'שולחת אותה לכל שאר הפורטים', 'שומרת אותה עד שהקו פנוי', 'חוסמת אותה'],
      correct: 1,
      explain: 'הרכזת לא יודעת מי היעד. היא משכפלת את ההודעה לכל שאר הפורטים, ולכן כולם חולקים את אותו "קו": פיזית כוכב, לוגית אפיק.',
    },
    takeaway: 'רכזת = כוכב פיזית אבל אפיק לוגית: כל ההודעות משותפות, וכששניים שולחים יחד יש התנגשות.',
  },
  {
    id: 'switch',
    title: 'כוכב אמיתי עם מתג',
    topology: 'כוכב (Star)',
    intro: [
      'הרשת גדלה, והרכזת נחנקת מהתנגשויות.',
      'לחצו על הרכזת ושדרגו אותה למתג. מתג שולח הודעה רק אל הפורט של היעד, וכמה שיחות יכולות לעבור יחד.',
      'בנוסף, מדי פעם כבל נקרע. לחצו על כבל קרוע כדי לתקן אותו.',
    ],
    goal: 'שדרגו למתג, חברו את כולם, ותקנו כבלים קרועים.',
    nodes: [
      { id: 'S', kind: 'server', x: 480, y: 90, label: 'שרת', appearAt: 0 },
      { id: 'H', kind: 'hub', x: 480, y: 300, label: 'רכזת', appearAt: 0 },
      { id: 'PR', kind: 'printer', x: 800, y: 130, label: 'מדפסת', appearAt: 0 },
      { id: 'P1', kind: 'pc', x: 160, y: 250, label: 'מחשב 1', appearAt: 0 },
      { id: 'P2', kind: 'pc', x: 800, y: 330, label: 'מחשב 2', appearAt: 0 },
      { id: 'P3', kind: 'pc', x: 200, y: 480, label: 'מחשב 3', appearAt: 8 },
      { id: 'P4', kind: 'pc', x: 440, y: 530, label: 'מחשב 4', appearAt: 16 },
      { id: 'P5', kind: 'pc', x: 700, y: 510, label: 'מחשב 5', appearAt: 26 },
      { id: 'P6', kind: 'pc', x: 120, y: 90, label: 'מחשב 6', appearAt: 38 },
    ],
    budget: 120,
    duration: 80,
    spawnEvery: 3,
    patience: 12,
    upgradeCost: 15,
    cuts: [{ at: 34 }, { at: 58 }],
    stars: [0.55, 0.75, 0.88],
    check: {
      q: 'בטופולוגיית כוכב, מה קורה כשהכבל של מחשב אחד מתנתק?',
      options: ['כל הרשת נופלת', 'רק אותו מחשב מתנתק', 'הרשת הופכת לטבעת', 'המתג מתאפס'],
      correct: 1,
      explain: 'לכל מחשב כבל משלו עד המתג, לכן תקלה בכבל אחד פוגעת רק בו. התקלה המסוכנת היא במתג המרכזי עצמו.',
    },
    takeaway: 'כוכב עם מתג: תקלה בכבל פוגעת במחשב אחד בלבד, והמתג מאפשר כמה שיחות במקביל.',
  },
  {
    id: 'mesh',
    title: 'לא שמים את כל הביצים בסל אחד',
    topology: 'כוכב מורחב ו-Mesh חלקי',
    intro: [
      'עכשיו יש שני מתגים ושרת אחד. אם הכבל לשרת נקרע, כל הרשת נשארת בלי שירות.',
      'בנו נתיב חלופי: חברו גם את המתג השני לשרת, וחברו בין המתגים. כך הודעה יכולה לעקוף תקלה.',
      'כבל נוסף עולה כסף, ולכן צריך לבחור איפה כדאי.',
    ],
    goal: 'שרדו שתי תקלות בלי לאבד את השרת.',
    nodes: [
      { id: 'S', kind: 'server', x: 480, y: 80, label: 'שרת', appearAt: 0 },
      { id: 'A', kind: 'switch', x: 310, y: 280, label: 'מתג A', appearAt: 0 },
      { id: 'B', kind: 'switch', x: 650, y: 280, label: 'מתג B', appearAt: 0 },
      { id: 'P1', kind: 'pc', x: 110, y: 200, label: 'מחשב 1', appearAt: 0 },
      { id: 'P2', kind: 'pc', x: 130, y: 430, label: 'מחשב 2', appearAt: 0 },
      { id: 'P3', kind: 'pc', x: 330, y: 520, label: 'מחשב 3', appearAt: 10 },
      { id: 'P4', kind: 'pc', x: 850, y: 200, label: 'מחשב 4', appearAt: 0 },
      { id: 'P5', kind: 'pc', x: 830, y: 440, label: 'מחשב 5', appearAt: 14 },
      { id: 'PR', kind: 'printer', x: 640, y: 530, label: 'מדפסת', appearAt: 24 },
    ],
    budget: 170,
    duration: 90,
    spawnEvery: 3.2,
    patience: 6,
    upgradeCost: null,
    cuts: [{ at: 24, near: 'S' }, { at: 46, near: 'A' }, { at: 68, near: 'S' }],
    stars: [0.5, 0.7, 0.85],
    check: {
      q: 'איזו טופולוגיה נותנת כמה נתיבים חלופיים בין שני התקנים?',
      options: ['Bus', 'Ring עם כבל אחד', 'Mesh (חלקי או מלא)', 'Star עם מתג אחד'],
      correct: 2,
      explain: 'ב-Mesh יש קשרים מרובים בין ההתקנים, ולכן כשנתיב נופל ההודעה עוברת בנתיב אחר. המחיר: יותר כבלים ויותר תחזוקה.',
    },
    takeaway: 'נתיבים חלופיים = עמידות לתקלות. הם עולים יותר כבלים, לכן בוחרים אותם איפה שנקודת הכשל כואבת.',
  },
];
