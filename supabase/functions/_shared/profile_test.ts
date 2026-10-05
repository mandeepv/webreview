import { assertEquals } from 'jsr:@std/assert@1';
import { profileFromAnswers } from './profile.ts';

const ID = '00000000-0000-4000-8000-000000000001';

Deno.test('a full quiz maps to the app profile, goals and mood left out (v1)', () => {
  assertEquals(
    profileFromAnswers(ID, {
      role: 'mother',
      name: '  Sam ',
      'children-count': '3+',
      'child-age': '5-7',
      experience: 'somewhat-familiar',
      goals: ['calm_mornings'],
      mood: 'stretched',
      phone: 'iphone',
    }),
    {
      id: ID,
      user_type: 'mother',
      name: 'Sam',
      children_count: 3,
      children: [{ ageRange: '5-7' }],
      experience_level: 'somewhat-familiar',
    }
  );
});

Deno.test('no valid role, no profile — the app would not count it as onboarded anyway', () => {
  assertEquals(profileFromAnswers(ID, {}), null);
  assertEquals(profileFromAnswers(ID, null), null);
  assertEquals(profileFromAnswers(ID, { role: 'grandparent', name: 'Sam' }), null);
});

Deno.test('unknown or missing values are omitted, never invented', () => {
  assertEquals(
    profileFromAnswers(ID, { role: 'father', name: 'Parent', 'children-count': '7', 'child-age': '18+', experience: 'expert' }),
    { id: ID, user_type: 'father' }
  );
  assertEquals(profileFromAnswers(ID, { role: 'other', name: '   ' }), { id: ID, user_type: 'other' });
});

Deno.test('every children-count answer maps', () => {
  for (const [answer, n] of [['1', 1], ['2', 2], ['3+', 3]] as const) {
    assertEquals(profileFromAnswers(ID, { role: 'mother', 'children-count': answer })?.children_count, n);
  }
});

Deno.test('a long name is cut to 40 characters', () => {
  assertEquals(profileFromAnswers(ID, { role: 'mother', name: 'x'.repeat(60) })?.name?.length, 40);
});
