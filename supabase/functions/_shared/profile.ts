// Web quiz answers → the iOS app's user_profiles row (03-app-changes §5).
// Pure, so profile_test.ts covers every mapping.
//
// The app counts a buyer as onboarded only when user_type is set, so a row
// is built only when the quiz's (required) role answer is valid. Every other
// field is omitted rather than guessed when the answer is missing or not one
// of the app's own values (app INVARIANTS #7: omit, never invent).
//
// goals → improvement_goals and mood → emotional_challenges are deliberately
// NOT mapped in v1: the web and app vocabularies differ and no mapping has
// been agreed. The app reads the profile lightly; both stay null.

export type QuizAnswers = Record<string, unknown>;

export type AppProfileInsert = {
  id: string;
  user_type: 'mother' | 'father' | 'other';
  name?: string;
  children_count?: number;
  children?: Array<{ ageRange: string }>;
  experience_level?: string;
};

const USER_TYPES = ['mother', 'father', 'other'] as const;
const CHILDREN_COUNT: Record<string, number> = { '1': 1, '2': 2, '3+': 3 };
const AGE_RANGES = ['0-1', '2-4', '5-7', '8-12', '13-17'];
const EXPERIENCE = ['new-to-science', 'somewhat-familiar', 'know-a-lot'];

export function profileFromAnswers(userId: string, answers: QuizAnswers | null | undefined): AppProfileInsert | null {
  const a = answers ?? {};
  const role = a['role'];
  if (typeof role !== 'string' || !(USER_TYPES as readonly string[]).includes(role)) return null;

  const row: AppProfileInsert = { id: userId, user_type: role as AppProfileInsert['user_type'] };

  // Same rule as the app: a real name only, never the 'Parent' fallback.
  const name = typeof a['name'] === 'string' ? a['name'].trim().slice(0, 40) : '';
  if (name && name !== 'Parent') row.name = name;

  const count = CHILDREN_COUNT[String(a['children-count'] ?? '')];
  if (count) row.children_count = count;

  const age = a['child-age'];
  if (typeof age === 'string' && AGE_RANGES.includes(age)) row.children = [{ ageRange: age }];

  const experience = a['experience'];
  if (typeof experience === 'string' && EXPERIENCE.includes(experience)) row.experience_level = experience;

  return row;
}
