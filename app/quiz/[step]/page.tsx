import { notFound } from 'next/navigation';
import { QUIZ_STEPS } from '@/lib/quiz/questions';
import QuizStep from './quiz-client';

// Pre-render all steps; the quiz is pure client state on static pages.
export function generateStaticParams() {
  return QUIZ_STEPS.map((_, i) => ({ step: String(i + 1) }));
}

export default async function Page({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  // /quiz/0, /quiz/99, /quiz/abc: a 404, not an empty 200 page (review P3).
  // notFound() rather than dynamicParams = false, which logs an error stack
  // for every such request.
  if (!/^[1-9]\d*$/.test(step) || Number(step) > QUIZ_STEPS.length) notFound();
  return <QuizStep stepNumber={Number(step)} />;
}
