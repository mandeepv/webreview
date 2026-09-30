import type { Config } from 'tailwindcss';

// The cream/forest onboarding design system, ported VERBATIM from the app
// repo's src/constants/theme.ts (OnboardingColors/Type/Radius/Layout — the
// design/onboarding-lesson-revamp branch, built from the Claude Design canvas
// "Kinderwell Onboarding Set"). Hierarchy is built with ink at alpha
// (text-ink/60 etc.), not extra greys. If the app's tokens change, change
// these the same day.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#23211e', // text, hairlines
        paper: '#eee9dc', // screen canvas
        wash: '#e5dbc9', // tinted rows, cards, unselected multi-select
        forest: '#2f6b4a', // primary action, selected states, progress
        'forest-deep': '#23423a', // full-bleed takeover surfaces
        mint: '#c9e3d3', // eyebrow/secondary numerals ON forest surfaces
        clay: '#c0653c', // accent — used sparingly
        'clay-deep': '#8f4526', // canvas eyebrow label
        cream: '#fbf7ef', // text/icons on forest + ink
      },
      fontFamily: {
        serif: ['var(--font-serif)', 'Georgia', 'serif'], // Newsreader — every headline
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'], // Figtree — UI/labels
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'], // IBM Plex Mono — step/eyebrow labels
      },
      borderRadius: {
        row: '16px', // option rows
        callout: '18px',
        card: '22px', // cards
      },
    },
  },
  plugins: [],
};

export default config;
