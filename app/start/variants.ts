// Message-match variants: the headline the user clicked is the headline they
// land on. Default = the VBWelcome cold-open. *stars* mark the italic phrase.
export const VARIANTS: Record<string, { headline: string; sub: string }> = {
  default: {
    headline: 'The most important job you’ll ever do. And *nobody trained you* for it.',
    sub: 'You learn on the fly, running on no sleep, hoping today goes better than yesterday. Answer a few questions and we’ll build a plan around your child. Two minutes, tops.',
  },
  tantrums: {
    headline: 'Tantrums aren’t a discipline problem. They’re a *skills gap* — yours to close.',
    sub: '10 minutes a day of science-based lessons that show you exactly what to do mid-meltdown.',
  },
  listening: {
    headline: '“How many times do I have to say it?” There’s a *reason* they don’t listen.',
    sub: 'Learn the communication shifts that end the repeat-yourself loop, in 10 minutes a day.',
  },
  yelling: {
    headline: 'You don’t want to be the parent who yells. You need a *plan* for that moment.',
    sub: 'Science-based lessons that give you the words before you lose them.',
  },
};
