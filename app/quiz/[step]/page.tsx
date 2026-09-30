import { QUIZ_STEPS } from '@/lib/quiz/questions';
import QuizStep from './quiz-client';

// Pre-render all steps; the quiz is pure client state on static pages.
export function generateStaticParams() {
  return QUIZ_STEPS.map((_, i) => ({ step: String(i + 1) }));
}

export default async function Page({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  return <QuizStep stepNumber={Number(step)} />;
}
