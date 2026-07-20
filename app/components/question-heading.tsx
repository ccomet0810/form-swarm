import type { ReactNode } from "react";
import type { FormQuestion } from "../../lib/domain/form-schema";

export function RequiredMark() {
  return (
    <>
      <span className="required-mark" aria-hidden="true">*</span>
      <span className="sr-only"> (필수)</span>
    </>
  );
}

export function QuestionHeading({
  question,
  level,
  children,
}: {
  question: FormQuestion;
  level: 2 | 3;
  children?: ReactNode;
}) {
  const content = (
    <>
      {question.title || "제목 없는 문항"}
      {question.required && <RequiredMark />}
      {children}
    </>
  );

  return level === 2
    ? <h2 className="question-heading">{content}</h2>
    : <h3 className="question-heading">{content}</h3>;
}
