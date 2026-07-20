"use client";

/* eslint-disable @next/next/no-img-element */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Circle, Heart, Search, Send, Sparkles, Star, ThumbsUp } from "lucide-react";
import type {
  FormImageRef,
  FormItem,
  FormQuestion,
  FormSection,
  FormValidation,
  GeneratedAnswer,
  GeneratedResponse,
  GenerationRule,
  ImportedForm,
  QuestionType,
} from "../../lib/domain/form-schema";
import { constraintsForQuestion } from "../../lib/generator/constraints";
import { generateResponses } from "../../lib/generator/engine";
import { createDefaultRules } from "../../lib/generator/rules";
import { matchesTextConstraints, validateGeneratedResponse } from "../../lib/generator/validation";
import { ResponseSummaryCard } from "./response-summary";

// These are Google Forms API v1 union member names derived from our normalized
// responder-HTML type. They are mappings, not fields read from a Forms API response.
const GOOGLE_FORMS_API_TYPE: Record<QuestionType, {
  itemMember: "questionItem" | "questionGroupItem";
  questionMember: "choiceQuestion" | "textQuestion" | "scaleQuestion" | "dateQuestion" | "timeQuestion" | "ratingQuestion" | "rowQuestion" | null;
  choiceType?: "RADIO" | "CHECKBOX" | "DROP_DOWN";
  paragraph?: boolean;
  groupMember?: "grid";
}> = {
  short_text: { itemMember: "questionItem", questionMember: "textQuestion", paragraph: false },
  paragraph: { itemMember: "questionItem", questionMember: "textQuestion", paragraph: true },
  single_choice: { itemMember: "questionItem", questionMember: "choiceQuestion", choiceType: "RADIO" },
  dropdown: { itemMember: "questionItem", questionMember: "choiceQuestion", choiceType: "DROP_DOWN" },
  checkboxes: { itemMember: "questionItem", questionMember: "choiceQuestion", choiceType: "CHECKBOX" },
  scale: { itemMember: "questionItem", questionMember: "scaleQuestion" },
  grid_single: { itemMember: "questionGroupItem", questionMember: "rowQuestion", choiceType: "RADIO", groupMember: "grid" },
  grid_checkbox: { itemMember: "questionGroupItem", questionMember: "rowQuestion", choiceType: "CHECKBOX", groupMember: "grid" },
  rating: { itemMember: "questionItem", questionMember: "ratingQuestion" },
  date: { itemMember: "questionItem", questionMember: "dateQuestion" },
  time: { itemMember: "questionItem", questionMember: "timeQuestion" },
  unknown: { itemMember: "questionItem", questionMember: null },
};

interface SubmissionProgress {
  done: number;
  accepted: number;
  failed: number;
  error: string | null;
}

interface RuleIssue {
  questionId: string;
  fieldId: string;
  message: string;
}

type TextGenerationMode = "rules" | "ai" | "manual";
type TextSource = TextGenerationMode | "rules";
type PreviewTab = "summary" | "question" | "individual";
type WorkspaceTab = "questions" | PreviewTab;
type DisplayFormItem = FormQuestion | Exclude<FormItem, { kind: "section" }>;

function nonEmptyLines(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function defaultAiPrompt(question: FormQuestion): string {
  const constraints = constraintsForQuestion(question);
  const format = constraints.textKind === "number"
    ? "숫자만"
    : constraints.textKind === "email"
      ? "유효한 이메일 주소 형식으로"
      : constraints.textKind === "url"
        ? "유효한 웹 주소 형식으로"
        : question.type === "paragraph"
          ? "자연스럽고 구체적인 서술형 문장으로"
          : "자연스럽고 간결한 단답형 문구로";
  const limits = [
    constraints.minValue !== undefined ? `${constraints.minValue} 이상` : null,
    constraints.maxValue !== undefined ? `${constraints.maxValue} 이하` : null,
    constraints.excludedNumberRange
      ? `${constraints.excludedNumberRange.min}–${constraints.excludedNumberRange.max} 구간 제외`
      : null,
    constraints.minLength !== undefined ? `최소 ${constraints.minLength}자` : null,
    constraints.maxLength !== undefined ? `최대 ${constraints.maxLength}자` : null,
  ].filter(Boolean).join(", ");
  return `문항의 제목과 설명을 반영해 ${format} 서로 다른 응답을 생성해 주세요.${limits ? ` 조건: ${limits}.` : ""}`;
}

function ruleGeneratedTextLabel(question: FormQuestion): string {
  const constraints = constraintsForQuestion(question);
  if (constraints.textKind === "email") return "테스트 이메일 자동 생성";
  if (constraints.textKind === "url") return "테스트 URL 자동 생성";
  if (constraints.excludedNumberRange) {
    return `${constraints.excludedNumberRange.min}–${constraints.excludedNumberRange.max} 제외 무작위`;
  }
  if (constraints.textKind === "number") {
    if (constraints.minValue !== undefined && constraints.maxValue !== undefined) {
      return `${constraints.minValue}–${constraints.maxValue} 범위 내 무작위`;
    }
    if (constraints.minValue !== undefined) return `${constraints.minValue} 이상 무작위`;
    if (constraints.maxValue !== undefined) return `${constraints.maxValue} 이하 무작위`;
    return "숫자 무작위";
  }
  return "자동 생성";
}

function usableOtherLines(question: FormQuestion, values: string[]): string[] {
  const regularValues = new Set(
    question.options
      .filter((option) => !option.isOther)
      .flatMap((option) => [option.label, option.value]),
  );
  return [...new Set(
    nonEmptyLines(values).filter(
      (value) => value.length <= 20_000 && !regularValues.has(value),
    ),
  )];
}

function AutoGrowTextarea({
  id,
  value,
  onValueChange,
  ariaDescribedBy,
  placeholder,
  maxLength,
  invalid = false,
}: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  ariaDescribedBy?: string;
  placeholder?: string;
  maxLength?: number;
  invalid?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => {
      element.style.height = "auto";
      const styles = window.getComputedStyle(element);
      const borderHeight =
        Number.parseFloat(styles.borderTopWidth) +
        Number.parseFloat(styles.borderBottomWidth);
      element.style.height = `${element.scrollHeight + borderHeight}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [value]);

  return (
    <textarea
      ref={ref}
      id={id}
      rows={3}
      value={value}
      aria-describedby={ariaDescribedBy}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(event) => onValueChange(event.target.value)}
    />
  );
}

function InfoDetails({ children }: { children: React.ReactNode }) {
  return (
    <details className="info-details">
      <summary>정보</summary>
      <dl className="question-meta">{children}</dl>
    </details>
  );
}

function answerLabel(answer: GeneratedAnswer | undefined): string {
  if (answer === undefined) return "응답 없음";
  if (typeof answer === "string") return answer;
  if (Array.isArray(answer)) return answer.length > 0 ? answer.join(", ") : "선택 없음";
  return Object.entries(answer)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join(" · ");
}

function hasGeneratedAnswer(answer: GeneratedAnswer | undefined): answer is GeneratedAnswer {
  if (answer === undefined) return false;
  if (typeof answer === "string") return answer.trim().length > 0;
  if (Array.isArray(answer)) return answer.some((value) => value.trim().length > 0);
  return Object.values(answer).some((value) => Array.isArray(value)
    ? value.some((part) => part.trim().length > 0)
    : value.trim().length > 0);
}

function groupedQuestionAnswers(
  question: FormQuestion,
  responses: GeneratedResponse[],
): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  const optionOrder = new Map(question.options.flatMap((option, index) => [
    [option.value, index] as const,
    [option.label, index] as const,
  ]));
  for (const response of responses) {
    const answer = response.answers[question.id];
    if (!hasGeneratedAnswer(answer)) continue;
    const label = question.type === "checkboxes" && Array.isArray(answer)
      ? [...answer]
        .sort((left, right) => (
          (optionOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (optionOrder.get(right) ?? Number.MAX_SAFE_INTEGER) ||
          left.localeCompare(right, "ko")
        ))
        .join(", ")
      : answerLabel(answer);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"));
}

function validationLabel(validation: FormValidation): string {
  if (validation.kind === "number_range") {
    return `kind=${validation.kind} · operator=${validation.operator} · min=${validation.min} · max=${validation.max}${validation.errorMessage ? ` · errorMessage=${JSON.stringify(validation.errorMessage)}` : ""}`;
  }
  if (validation.kind === "text_length") {
    return `kind=${validation.kind} · operator=${validation.operator} · value=${validation.value}${validation.errorMessage ? ` · errorMessage=${JSON.stringify(validation.errorMessage)}` : ""}`;
  }
  return `kind=${validation.kind} · operator=${validation.operator} · value=${validation.value}${validation.errorMessage ? ` · errorMessage=${JSON.stringify(validation.errorMessage)}` : ""}`;
}

function QuestionTypeInfo({ question }: { question: FormQuestion }) {
  const apiType = GOOGLE_FORMS_API_TYPE[question.type];
  const apiMembers = [
    `Item.${apiType.itemMember}`,
    apiType.groupMember ? `QuestionGroupItem.${apiType.groupMember}` : null,
    apiType.questionMember ? `Question.${apiType.questionMember}` : null,
  ].filter((value): value is string => value !== null);
  return (
    <>
      <dt>FormQuestion.type</dt><dd>{question.type}</dd>
      <dt>Google Forms API</dt><dd>{apiMembers.join(" → ")}</dd>
      {apiType.choiceType && (
        <>
          <dt>{apiType.groupMember ? "Grid.columns.type" : "ChoiceQuestion.type"}</dt>
          <dd>{apiType.choiceType}</dd>
        </>
      )}
      {typeof apiType.paragraph === "boolean" && (
        <><dt>TextQuestion.paragraph</dt><dd>{String(apiType.paragraph)}</dd></>
      )}
    </>
  );
}

function ImageView({ image, className = "media-image" }: { image: FormImageRef; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!image.url) {
    return <p className="media-fallback">이미지 ID {image.sourceId} · 표시 URL 없음</p>;
  }
  if (failedUrl === image.url) {
    return (
      <div className="media-fallback" role="status">
        <span>이미지를 불러오지 못했습니다. 이미지 ID {image.sourceId}</span>
        <button type="button" onClick={() => setFailedUrl(null)}>다시 시도</button>
      </div>
    );
  }
  return (
    <img
      className={className}
      src={`/api/forms/image?url=${encodeURIComponent(image.url)}`}
      alt={image.altText ?? "Google Forms 이미지"}
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      loading="lazy"
      onError={() => setFailedUrl(image.url)}
    />
  );
}

function AnswerOptionContent({
  option,
}: {
  option: FormQuestion["options"][number];
}) {
  return (
    <div className={`answer-option-content${option.isOther ? " answer-option-content--other" : ""}`}>
      <span>{option.isOther ? "기타" : option.label}</span>
      {option.isOther && <span className="answer-other-line" aria-hidden="true" />}
      {option.image && <ImageView image={option.image} />}
    </div>
  );
}

function QuestionAnswerPreview({ question }: { question: FormQuestion }) {
  if (question.grid) {
    const markerType = question.type === "grid_checkbox" ? "checkbox" : "radio";
    return (
      <div className="answer-preview answer-preview--grid">
        <div className="grid-table-wrap">
          <table className="grid-table answer-grid">
            <caption className="sr-only">{question.title}의 행과 열</caption>
            <thead>
              <tr>
                <th scope="col">행</th>
                {question.grid.columns.map((column) => <th scope="col" key={column.id}>{column.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {question.grid.rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.label}</th>
                  {question.grid?.columns.map((column) => (
                    <td key={column.id}>
                      <span className={`answer-mark answer-mark--${markerType}`} aria-hidden="true" />
                      <span className="sr-only">{row.label}에서 {column.label} 선택</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="answer-constraint">
          행별 응답 {question.grid.requireResponsePerRow ? "필수" : "선택"}
          {question.grid.limitOneResponsePerColumn ? " / 열당 하나만 선택" : ""}
        </p>
      </div>
    );
  }

  if (question.type === "single_choice" || question.type === "checkboxes") {
    const markerType = question.type === "checkboxes" ? "checkbox" : "radio";
    return (
      <div className={`answer-preview answer-preview--${question.type}`}>
        <ul className="answer-options" aria-label={`${question.title} 선택지`}>
          {question.options.map((option, index) => (
            <li className="answer-option" key={`${option.index ?? index}:${option.value}`}>
              <span className={`answer-mark answer-mark--${markerType}`} aria-hidden="true" />
              <AnswerOptionContent option={option} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (question.type === "dropdown") {
    return (
      <div className="answer-preview answer-preview--dropdown">
        <div className="answer-dropdown-shell" aria-hidden="true">
          <span>항목 선택</span>
          <span className="answer-dropdown-chevron" />
        </div>
        <ol className="answer-options answer-options--dropdown" aria-label={`${question.title} 선택지`}>
          {question.options.map((option, index) => (
            <li className="answer-option" key={`${option.index ?? index}:${option.value}`}>
              <span className="answer-option-index" aria-hidden="true">{index + 1}</span>
              <AnswerOptionContent option={option} />
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (question.type === "scale" && question.scale) {
    const values = Array.from(
      { length: question.scale.max - question.scale.min + 1 },
      (_, index) => question.scale!.min + index,
    );
    return (
      <div className="answer-preview answer-preview--scale">
        <div className="scale-preview-scroll">
          <div
            className="scale-preview"
            style={{ "--ordinal-count": values.length } as React.CSSProperties}
          >
            <span className="scale-edge-label">{question.scale.lowLabel ?? ""}</span>
            <ol className="scale-points" aria-label={`${question.title} 배율`}>
              {values.map((value) => (
                <li className="scale-point" key={value}>
                  <span>{value}</span>
                  <span className="answer-mark answer-mark--radio" aria-hidden="true" />
                </li>
              ))}
            </ol>
            <span className="scale-edge-label">{question.scale.highLabel ?? ""}</span>
          </div>
        </div>
      </div>
    );
  }

  if (question.type === "rating" && question.rating) {
    const values = Array.from(
      { length: question.rating.max - question.rating.min + 1 },
      (_, index) => question.rating!.min + index,
    );
    const RatingIcon = question.rating.icon === "heart"
      ? Heart
      : question.rating.icon === "thumbs_up"
        ? ThumbsUp
        : question.rating.icon === "star"
          ? Star
          : Circle;
    return (
      <div className="answer-preview answer-preview--rating">
        <div className="rating-preview-scroll">
          <ol
            className="rating-preview"
            aria-label={`${question.title} 등급`}
            style={{ "--ordinal-count": values.length } as React.CSSProperties}
          >
            {values.map((value) => (
              <li className="rating-point" key={value}>
                <span>{value}</span>
                <RatingIcon
                  className="rating-glyph"
                  size={24}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  if (question.type === "short_text" || question.type === "paragraph") {
    return (
      <div className={`answer-preview answer-preview--${question.type}`}>
        <div className={`text-answer-preview text-answer-preview--${question.type}`}>
          <span>{question.type === "short_text" ? "단답형 응답" : "장문형 응답"}</span>
        </div>
      </div>
    );
  }

  if (question.type === "date" || question.type === "time") {
    const placeholder = question.type === "date"
      ? question.date?.includeTime
        ? question.date.includeYear ? "YYYY-MM-DD  HH:MM" : "MM-DD  HH:MM"
        : question.date?.includeYear ? "YYYY-MM-DD" : "MM-DD"
      : question.time?.kind === "duration" ? "시간 : 분 : 초" : "HH : MM";
    return (
      <div className={`answer-preview answer-preview--${question.type}`}>
        <div className="temporal-answer-preview">{placeholder}</div>
      </div>
    );
  }

  if (question.options.length > 0) {
    return (
      <div className="answer-preview">
        <ul className="answer-options answer-options--plain" aria-label={`${question.title} 선택지`}>
          {question.options.map((option, index) => (
            <li className="answer-option" key={`${option.index ?? index}:${option.value}`}>
              <span className="answer-option-index" aria-hidden="true">{index + 1}</span>
              <AnswerOptionContent option={option} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return null;
}

function ResponseNavigator({
  label,
  index,
  total,
  onChange,
}: {
  label: "문항" | "응답";
  index: number;
  total: number;
  onChange: (index: number) => void;
}) {
  const clampedIndex = Math.max(0, Math.min(total - 1, index));
  return (
    <div className="response-navigator" aria-label={`${label} 이동`}>
      <button
        type="button"
        disabled={clampedIndex <= 0}
        onClick={() => onChange(clampedIndex - 1)}
      >
        이전
      </button>
      <label>
        <span className="sr-only">{label} 번호</span>
        <input
          type="number"
          min={1}
          max={total}
          value={clampedIndex + 1}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) onChange(Math.max(0, Math.min(total - 1, value - 1)));
          }}
        />
      </label>
      <span aria-hidden="true">/</span>
      <b>{total}</b>
      <button
        type="button"
        disabled={clampedIndex >= total - 1}
        onClick={() => onChange(clampedIndex + 1)}
      >
        다음
      </button>
    </div>
  );
}

function ReadonlyGeneratedAnswer({
  question,
  answer,
}: {
  question: FormQuestion;
  answer: GeneratedAnswer | undefined;
}) {
  if (!hasGeneratedAnswer(answer)) {
    return <p className="readonly-empty-answer">응답 없음</p>;
  }

  if (question.type === "short_text" || question.type === "paragraph") {
    return (
      <div className={`readonly-text-answer readonly-text-answer--${question.type}`}>
        {answerLabel(answer)}
      </div>
    );
  }

  if (question.type === "single_choice" || question.type === "checkboxes") {
    const answers = new Set(Array.isArray(answer) ? answer : [answerLabel(answer)]);
    const markerType = question.type === "checkboxes" ? "checkbox" : "radio";
    const regularValues = new Set(question.options.flatMap((option) => [option.value, option.label]));
    const customAnswers = [...answers].filter((value) => !regularValues.has(value));
    return (
      <ul
        className="readonly-choice-list"
        role={markerType === "radio" ? "radiogroup" : "group"}
        aria-label={`${question.title}의 응답`}
      >
        {question.options.map((option, index) => {
          const selected = option.isOther
            ? customAnswers.length > 0
            : answers.has(option.value) || answers.has(option.label);
          return (
            <li key={`${option.index ?? index}:${option.value}`} data-selected={selected || undefined}>
              <span
                className={`answer-mark answer-mark--${markerType}`}
                role={markerType}
                aria-checked={selected}
                aria-disabled="true"
              />
              <span>{option.isOther ? `기타${customAnswers.length > 0 ? `: ${customAnswers.join(", ")}` : ""}` : option.label}</span>
            </li>
          );
        })}
      </ul>
    );
  }

  if (question.type === "dropdown") {
    return <div className="readonly-dropdown-answer">{answerLabel(answer)}</div>;
  }

  if ((question.type === "scale" || question.type === "rating") && typeof answer === "string") {
    const values = question.type === "scale" && question.scale
      ? Array.from({ length: question.scale.max - question.scale.min + 1 }, (_, index) => question.scale!.min + index)
      : question.rating
        ? Array.from({ length: question.rating.max - question.rating.min + 1 }, (_, index) => question.rating!.min + index)
        : question.options.map((option) => Number(option.value)).filter(Number.isFinite);
    return (
      <ol
        className="readonly-ordinal-answer"
        role="radiogroup"
        aria-label={`${question.title}의 응답`}
        style={{ "--ordinal-count": values.length } as React.CSSProperties}
      >
        {values.map((value) => {
          const selected = String(value) === answer;
          return (
          <li key={value} data-selected={selected || undefined}>
            <span>{value}</span>
            <i
              role="radio"
              aria-checked={selected}
              aria-disabled="true"
              aria-label={`${value}`}
            />
          </li>
          );
        })}
      </ol>
    );
  }

  if (question.grid && typeof answer === "object" && !Array.isArray(answer)) {
    return (
      <div className="readonly-grid-wrap" role="region" tabIndex={0} aria-label={`${question.title} 응답 표`}>
        <table
          className="readonly-grid-answer"
          style={{
            "--readonly-grid-min-width": `${Math.max(280, (question.grid.columns.length + 1) * 70)}px`,
          } as React.CSSProperties}
        >
          <thead>
            <tr><th />{question.grid.columns.map((column) => <th key={column.id}>{column.label}</th>)}</tr>
          </thead>
          <tbody>
            {question.grid.rows.map((row) => {
              const rowAnswer = answer[row.id] ?? answer[row.label];
              const selected = new Set(Array.isArray(rowAnswer) ? rowAnswer : rowAnswer ? [rowAnswer] : []);
              return (
                <tr key={row.id}>
                  <th>{row.label}</th>
                  {question.grid!.columns.map((column) => {
                    const isSelected = selected.has(column.label) || selected.has(column.id);
                    return (
                      <td key={column.id} data-selected={isSelected || undefined}>
                        <i
                          role={question.type === "grid_checkbox" ? "checkbox" : "radio"}
                          aria-checked={isSelected}
                          aria-disabled="true"
                          aria-label={`${row.label} · ${column.label}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return <div className="readonly-value-answer">{answerLabel(answer)}</div>;
}

function QuestionResponsePanel({
  question,
  responses,
}: {
  question: FormQuestion;
  responses: GeneratedResponse[];
}) {
  const values = groupedQuestionAnswers(question, responses);
  return (
    <div className="question-response-panel">
      <article className="question-response-title">
        <h3>{question.title}</h3>
        <span>응답 {responses.filter((response) => hasGeneratedAnswer(response.answers[question.id])).length}개</span>
      </article>
      {values.length > 0 ? (
        <div className="question-value-list">
          {values.map((value) => (
            <article key={value.label}>
              <p>{value.label}</p>
              <span>{value.count === 1 ? "응답 1개" : `응답 ${value.count}개`}</span>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-summary">표시할 응답이 없습니다.</p>
      )}
    </div>
  );
}

function IndividualResponsePanel({
  form,
  response,
  valid,
}: {
  form: ImportedForm;
  response: GeneratedResponse;
  valid: boolean;
}) {
  return (
    <article className="individual-response-sheet">
      <header>
        <h3>{form.title || "제목 없는 설문지"}</h3>
        {form.description && <p>{form.description}</p>}
        {!valid && <span>검토 필요</span>}
      </header>
      {form.sections.map((section) => {
        const questions = form.questions.filter((question) => question.sectionId === section.id);
        if (questions.length === 0) return null;
        return (
          <section className="response-section" key={section.id}>
            <header>
              <h4>{section.title || `섹션 ${section.index + 1}`}</h4>
              {section.description && <p>{section.description}</p>}
            </header>
            {questions.map((question) => (
              <div className="response-answer-card" key={question.id}>
                <h5>{question.title}{question.required && <span aria-label="필수">*</span>}</h5>
                {question.description && <p>{question.description}</p>}
                <ReadonlyGeneratedAnswer question={question} answer={response.answers[question.id]} />
              </div>
            ))}
          </section>
        );
      })}
    </article>
  );
}

function OtherAnswerEditor({
  question,
  rule,
  onChange,
  issue,
}: {
  question: FormQuestion;
  rule: Extract<GenerationRule, { kind: "choice" | "checkboxes" }>;
  onChange: (next: GenerationRule) => void;
  issue?: RuleIssue;
}) {
  if (!question.options.some((option) => option.isOther)) return null;
  const other = rule.other ?? { enabled: false, probability: 0.15, samples: [] };
  const fieldId = `other-pool-${question.id}`;

  return (
    <div className="other-answer-editor">
      <label>
        기타 직접 입력
        <select
          value={other.enabled ? "manual" : "off"}
          onChange={(event) => {
            const enabled = event.target.value === "manual";
            if (rule.kind === "checkboxes" && !enabled) {
              const regularCount = Math.max(
                1,
                question.options.filter((option) => !option.isOther).length,
              );
              onChange({
                ...rule,
                maxSelections: Math.min(rule.maxSelections, regularCount),
                other: { ...other, enabled },
              });
              return;
            }
            onChange({ ...rule, other: { ...other, enabled } });
          }}
        >
          <option value="off">사용 안 함</option>
          <option value="manual">직접 입력 목록에서 생성</option>
        </select>
      </label>
      {other.enabled && (
        <>
          <label>
            기타 선택 비율
            <span className="percent-input">
              <input
                type="number"
                min={1}
                max={100}
                value={Math.round(other.probability * 100)}
                onChange={(event) => onChange({
                  ...rule,
                  other: {
                    ...other,
                    probability: Math.max(0.01, Math.min(1, Number(event.target.value) / 100)),
                  },
                })}
              />
              <span aria-hidden="true">%</span>
            </span>
          </label>
          <label className="wide-field" htmlFor={fieldId}>
            기타 응답 문구
            <AutoGrowTextarea
              id={fieldId}
              value={other.samples.join("\n")}
              ariaDescribedBy={issue?.fieldId === fieldId ? `${fieldId}-error` : undefined}
              invalid={issue?.fieldId === fieldId}
              placeholder="한 줄에 응답 하나"
              onValueChange={(value) => onChange({
                ...rule,
                other: { ...other, samples: value.split(/\r?\n/) },
              })}
            />
          </label>
          {issue?.fieldId === fieldId && (
            <p className="inline-error" id={`${fieldId}-error`} role="alert">{issue.message}</p>
          )}
        </>
      )}
    </div>
  );
}

function RuleEditor({
  question,
  rule,
  textSource,
  aiPrompt,
  onTextSourceChange,
  onAiPromptChange,
  onChange,
  issue,
}: {
  question: FormQuestion;
  rule: GenerationRule | undefined;
  textSource: TextSource;
  aiPrompt: string;
  onTextSourceChange: (source: TextGenerationMode) => void;
  onAiPromptChange: (prompt: string) => void;
  onChange: (next: GenerationRule) => void;
  issue?: RuleIssue;
}) {
  if (!rule || rule.kind === "unsupported") {
    return (
      <div className="rule-editor compact-rule-editor">
        <div className="static-rule-field">
          <span>생성 방식</span>
          <strong>자동 생성 제외</strong>
        </div>
      </div>
    );
  }

  if (question.type === "date" || question.type === "time") {
    return (
      <div className="rule-editor compact-rule-editor">
        <div className="static-rule-field">
          <span>생성 방식</span>
          <strong>{question.type === "date" ? "날짜 자동 생성" : "시간 자동 생성"}</strong>
        </div>
      </div>
    );
  }

  if (rule.kind === "text") {
    const fieldId = `text-pool-${question.id}`;
    return (
      <div className="rule-editor">
        <label>
          생성 방식
          <select
            value={textSource}
            onChange={(event) => onTextSourceChange(event.target.value as TextGenerationMode)}
          >
            {hasStructuredTextRule(question) && (
              <option value="rules">{ruleGeneratedTextLabel(question)}</option>
            )}
            <option value="ai">AI 자동 생성</option>
            <option value="manual">직접 입력 목록</option>
          </select>
        </label>
        {textSource === "ai" && (
          <label className="wide-field ai-prompt-field" htmlFor={`ai-prompt-${question.id}`}>
            AI 프롬프트
            <AutoGrowTextarea
              id={`ai-prompt-${question.id}`}
              value={aiPrompt}
              maxLength={2_000}
              placeholder="예: 간결하고 자연스러운 한국어 응답"
              onValueChange={onAiPromptChange}
            />
          </label>
        )}
        {textSource === "manual" && (
          <>
            <label className="wide-field" htmlFor={fieldId}>
              응답 문구
              <AutoGrowTextarea
                id={fieldId}
                value={rule.samples.join("\n")}
                ariaDescribedBy={issue?.fieldId === fieldId ? `${fieldId}-error` : undefined}
                invalid={issue?.fieldId === fieldId}
                placeholder="한 줄에 응답 하나"
                onValueChange={(value) => onChange({
                  ...rule,
                  mode: "sample_pool",
                  samples: value.split(/\r?\n/),
                })}
              />
            </label>
            {issue?.fieldId === fieldId && (
              <p className="inline-error" id={`${fieldId}-error`} role="alert">{issue.message}</p>
            )}
          </>
        )}
      </div>
    );
  }

  if (rule.kind === "choice") {
    const options = question.options.filter((option) => !option.isOther);
    return (
      <div className="rule-editor">
        <label>
          생성 방식
          <select
            value={rule.mode}
            onChange={(event) => onChange({ ...rule, mode: event.target.value as "uniform" | "middle_weighted" | "fixed" })}
          >
            <option value="uniform">균등 무작위</option>
            <option value="middle_weighted">가운데 값 중심</option>
            <option value="fixed">고정 선택</option>
          </select>
        </label>
        {rule.mode === "fixed" && (
          <label>
            고정 선택지
            <select
              value={rule.fixedValue ?? options[0]?.value ?? ""}
              onChange={(event) => onChange({ ...rule, fixedValue: event.target.value })}
            >
              {options.map((option) => (
                <option key={`${option.index ?? option.value}:${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {rule.mode !== "fixed" && (
          <OtherAnswerEditor question={question} rule={rule} onChange={onChange} issue={issue} />
        )}
      </div>
    );
  }

  if (rule.kind === "checkboxes") {
    const maximum = Math.max(1, question.options.filter((option) => !option.isOther).length + (rule.other?.enabled ? 1 : 0));
    return (
      <div className="rule-editor">
        <label>
          최소 선택 수
          <input
            type="number"
            min={question.required ? 1 : 0}
            max={maximum}
            value={rule.minSelections}
            onChange={(event) => onChange({ ...rule, minSelections: Number(event.target.value) })}
          />
        </label>
        <label>
          최대 선택 수
          <input
            type="number"
            min={1}
            max={maximum}
            value={rule.maxSelections}
            onChange={(event) => onChange({ ...rule, maxSelections: Number(event.target.value) })}
          />
        </label>
        <OtherAnswerEditor question={question} rule={rule} onChange={onChange} issue={issue} />
      </div>
    );
  }

  return (
    <div className="rule-editor">
      <label>
        생성 방식
        <select
          value={rule.mode}
          onChange={(event) => onChange({ ...rule, mode: event.target.value as "uniform" | "middle_weighted" })}
        >
          <option value="uniform">행별 균등 무작위</option>
          <option value="middle_weighted">가운데 열 중심</option>
        </select>
      </label>
    </div>
  );
}

function QuestionView({
  question,
  rule,
  textSource,
  aiPrompt,
  onTextSourceChange,
  onAiPromptChange,
  onRuleChange,
  issue,
}: {
  question: FormQuestion;
  rule: GenerationRule | undefined;
  textSource: TextSource;
  aiPrompt: string;
  onTextSourceChange: (source: TextGenerationMode) => void;
  onAiPromptChange: (prompt: string) => void;
  onRuleChange: (next: GenerationRule) => void;
  issue?: RuleIssue;
}) {
  return (
    <article className="question-item" id={`question-${question.id}`}>
      <div className="question-layout">
        <div className="question-content">
          <div className="question-title-row">
            <h3>
              {question.title || "제목 없음"}
              {question.required && (
                <>
                  <span className="required-mark" aria-hidden="true">*</span>
                  <span className="sr-only"> (필수)</span>
                </>
              )}
            </h3>
          </div>

          {question.description && <p className="question-description">{question.description}</p>}

          {(question.images ?? []).map((image) => <ImageView key={image.sourceId} image={image} />)}

          <QuestionAnswerPreview question={question} />
        </div>

        <div
          className="question-rule-panel"
          role="group"
          aria-label={`${question.title || "제목 없음"} 생성 설정`}
        >
          <RuleEditor
            question={question}
            rule={rule}
            textSource={textSource}
            aiPrompt={aiPrompt}
            onTextSourceChange={onTextSourceChange}
            onAiPromptChange={onAiPromptChange}
            onChange={onRuleChange}
            issue={issue}
          />
        </div>
      </div>

      <InfoDetails>
        <QuestionTypeInfo question={question} />
        <dt>FormQuestion.required</dt><dd>{String(question.required)}</dd>
        <dt>FormQuestion.itemId</dt><dd>{question.itemId}</dd>
        <dt>FormQuestion.entryIds</dt>
        <dd>{question.entryIds.length > 0 ? question.entryIds.map((id) => <div key={id}>{id}</div>) : "[]"}</dd>
        <dt>FormQuestion.sectionId</dt><dd>{question.sectionId}</dd>
        <dt>FormQuestion.rawType</dt><dd>{question.rawType}</dd>
        {(question.validations ?? []).length > 0 && (
          <><dt>FormQuestion.validations</dt><dd>{question.validations?.map((validation, index) => <div key={`${validation.kind}-${index}`}>{validationLabel(validation)}</div>)}</dd></>
        )}
        {question.scale && (
          <>
            <dt>ScaleQuestion.low</dt><dd>{question.scale.min}</dd>
            <dt>ScaleQuestion.high</dt><dd>{question.scale.max}</dd>
            <dt>ScaleQuestion.lowLabel</dt><dd>{question.scale.lowLabel ?? "null"}</dd>
            <dt>ScaleQuestion.highLabel</dt><dd>{question.scale.highLabel ?? "null"}</dd>
          </>
        )}
        {question.rating && (
          <>
            <dt>RatingQuestion.ratingScaleLevel</dt><dd>{question.rating.max}</dd>
            <dt>FormQuestion.rating.icon</dt><dd>{question.rating.icon}</dd>
            {question.rating.icon !== "unknown" && (
              <><dt>RatingQuestion.iconType</dt><dd>{question.rating.icon === "thumbs_up" ? "THUMB_UP" : question.rating.icon.toUpperCase()}</dd></>
            )}
          </>
        )}
        {question.date && (
          <>
            <dt>DateQuestion.includeYear</dt><dd>{String(question.date.includeYear)}</dd>
            <dt>DateQuestion.includeTime</dt><dd>{String(question.date.includeTime)}</dd>
          </>
        )}
        {question.time && (
          <>
            <dt>TimeQuestion.duration</dt><dd>{String(question.time.kind === "duration")}</dd>
          </>
        )}
        {question.grid && (
          <>
            <dt>FormQuestion.grid.rows[].entryId</dt>
            <dd>{question.grid.rows.map((row) => <div key={row.id}>{row.label}: {row.entryId ?? row.id}</div>)}</dd>
            <dt>FormQuestion.grid.columns[].id</dt>
            <dd>{question.grid.columns.map((column) => <div key={column.id}>{column.label}: {column.id}</div>)}</dd>
          </>
        )}
      </InfoDetails>
    </article>
  );
}

function FormSectionGroup({
  section,
  children,
}: {
  section: FormSection;
  children: React.ReactNode;
}) {
  const headingId = `form-section-heading-${section.index + 1}`;
  return (
    <section
      className="form-section-group"
      id={section.itemId ? `item-${section.itemId}` : undefined}
      aria-labelledby={headingId}
    >
      <header className="section-rail">
        <span className="section-marker" aria-hidden="true">
          {String(section.index + 1).padStart(2, "0")}
        </span>
        <div>
          <h3 id={headingId}>{section.title || `섹션 ${section.index + 1}`}</h3>
          {section.description && <p>{section.description}</p>}
        </div>
      </header>
      <div className="section-body item-list">{children}</div>
    </section>
  );
}

function ContentView({
  item,
}: {
  item: Exclude<FormItem, { kind: "question" } | { kind: "section" }>;
}) {

  if (item.kind === "text_block") {
    return (
      <div className="content-item" id={`item-${item.itemId}`}>
        {item.title && <h3>{item.title}</h3>}
        {item.description && <p>{item.description}</p>}
        <InfoDetails>
          <dt>FormItem.kind</dt><dd>{item.kind}</dd>
          <dt>Google Forms API</dt><dd>Item.textItem</dd>
          <dt>FormItem.itemId</dt><dd>{item.itemId}</dd>
          <dt>FormItem.rawType</dt><dd>{item.rawType}</dd>
        </InfoDetails>
      </div>
    );
  }

  if (item.kind === "image") {
    return (
      <div className="content-item" id={`item-${item.itemId}`}>
        {item.description && <p>{item.description}</p>}
        <ImageView image={item.image} />
        <InfoDetails>
          <dt>FormItem.kind</dt><dd>{item.kind}</dd>
          <dt>Google Forms API</dt><dd>Item.imageItem</dd>
          <dt>FormItem.itemId</dt><dd>{item.itemId}</dd>
          <dt>FormItem.rawType</dt><dd>{item.rawType}</dd>
          <dt>FormImageRef.sourceId</dt><dd>{item.image.sourceId}</dd>
        </InfoDetails>
      </div>
    );
  }

  return (
    <div className="content-item" id={`item-${item.itemId}`}>
      {item.title && <h3>{item.title}</h3>}
      {item.description && <p>{item.description}</p>}
      <iframe
        className="video-frame"
        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.video.videoId)}`}
        title={item.title || "Google Forms 동영상"}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
      <InfoDetails>
        <dt>FormItem.kind</dt><dd>{item.kind}</dd>
        <dt>Google Forms API</dt><dd>Item.videoItem</dd>
        <dt>FormItem.itemId</dt><dd>{item.itemId}</dd>
        <dt>FormItem.rawType</dt><dd>{item.rawType}</dd>
        <dt>FormVideoRef.videoId</dt><dd>{item.video.videoId}</dd>
      </InfoDetails>
    </div>
  );
}

function isConfigurableTextQuestion(question: FormQuestion): boolean {
  return question.type === "short_text" || question.type === "paragraph";
}

function hasStructuredTextRule(question: FormQuestion): boolean {
  if (question.type !== "short_text") return false;
  const constraints = constraintsForQuestion(question);
  return constraints.textKind !== "plain" || Boolean(constraints.excludedNumberRange);
}

export function Workbench() {
  const [url, setUrl] = useState("");
  const [analyzedUrl, setAnalyzedUrl] = useState<string | null>(null);
  const [form, setForm] = useState<ImportedForm | null>(null);
  const [rules, setRules] = useState<GenerationRule[]>([]);
  const [responses, setResponses] = useState<GeneratedResponse[]>([]);
  const [count, setCount] = useState<number | "">(10);
  const [analyzing, setAnalyzing] = useState(false);
  const [hasLaunched, setHasLaunched] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("questions");
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
  const [selectedResponseIndex, setSelectedResponseIndex] = useState(0);
  const [submission, setSubmission] = useState<SubmissionProgress | null>(null);
  const [textGenerationModes, setTextGenerationModes] = useState<Record<string, TextGenerationMode>>({});
  const [aiPrompts, setAiPrompts] = useState<Record<string, string>>({});
  const [ruleIssue, setRuleIssue] = useState<RuleIssue | null>(null);
  const promptSuggestionRequestRef = useRef(0);
  const editedPromptIdsRef = useRef<Set<string>>(new Set());
  const busy = analyzing || generating || submitting;
  const formIsStale = Boolean(form && analyzedUrl !== url.trim());

  const ruleMap = useMemo(() => new Map(rules.map((rule) => [rule.questionId, rule])), [rules]);
  const itemsBySection = useMemo(() => {
    const grouped = new Map<string, DisplayFormItem[]>();
    if (!form) return grouped;
    for (const section of form.sections) grouped.set(section.id, []);
    const orderedItems: Array<FormItem | FormQuestion> = form.items ?? form.questions;
    for (const item of orderedItems) {
      if ("kind" in item && item.kind === "section") continue;
      const sectionItems = grouped.get(item.sectionId) ?? [];
      sectionItems.push(item);
      grouped.set(item.sectionId, sectionItems);
    }
    return grouped;
  }, [form]);
  const validationResults = useMemo(
    () => form ? responses.map((response) => validateGeneratedResponse(form, response)) : [],
    [form, responses],
  );
  const allResponsesValid = validationResults.every((result) => result.valid);
  const selectedQuestion = form?.questions[Math.max(0, Math.min(form.questions.length - 1, selectedQuestionIndex))] ?? null;
  const selectedResponse = responses[Math.max(0, Math.min(responses.length - 1, selectedResponseIndex))] ?? null;

  function selectWorkspaceTab(tab: WorkspaceTab) {
    if (tab !== "questions" && responses.length === 0) return;
    setWorkspaceTab(tab);
  }

  function handleWorkspaceTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const tabs: WorkspaceTab[] = responses.length > 0
      ? ["questions", "summary", "question", "individual"]
      : ["questions"];
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const currentIndex = Math.max(0, tabs.indexOf(workspaceTab));
    const next = (currentIndex + direction + tabs.length) % tabs.length;
    event.preventDefault();
    setWorkspaceTab(tabs[next]);
    requestAnimationFrame(() => document.getElementById(`workspace-tab-${tabs[next]}`)?.focus());
  }

  async function loadPromptSuggestions(importedForm: ImportedForm, requestId: number) {
    const questions = importedForm.questions
      .filter(isConfigurableTextQuestion)
      .map((question) => {
        const constraints = constraintsForQuestion(question);
        return {
          id: question.id,
          type: question.type as "short_text" | "paragraph",
          title: question.title,
          description: question.description,
          required: question.required,
          textKind: constraints.textKind,
          ...(constraints.minLength !== undefined ? { minLength: constraints.minLength } : {}),
          ...(constraints.maxLength !== undefined ? { maxLength: constraints.maxLength } : {}),
          ...(constraints.minValue !== undefined ? { minValue: constraints.minValue } : {}),
          ...(constraints.maxValue !== undefined ? { maxValue: constraints.maxValue } : {}),
          ...(constraints.excludedNumberRange ? { excludedNumberRange: constraints.excludedNumberRange } : {}),
          ...(constraints.pattern ? { pattern: constraints.pattern } : {}),
        };
      });
    if (questions.length === 0) return;

    try {
      const result = await fetch("/api/ai/suggest-prompts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questions, locale: importedForm.locale || "ko" }),
      });
      const payload = await result.json() as {
        suggestions?: Array<{ questionId: string; prompt: string }>;
      };
      if (!result.ok || !payload.suggestions) return;
      if (promptSuggestionRequestRef.current !== requestId) return;
      setAiPrompts((current) => ({
        ...current,
        ...Object.fromEntries(payload.suggestions!
          .filter((suggestion) => (
            suggestion.prompt.trim().length > 0 &&
            !editedPromptIdsRef.current.has(suggestion.questionId)
          ))
          .map((suggestion) => [suggestion.questionId, suggestion.prompt.trim()])),
      }));
    } catch {
      // A constraint-aware local prompt is already present and remains editable.
    }
  }

  async function analyzeForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim() || busy) return;
    setHasLaunched(true);
    setAnalyzing(true);
    setError(null);
    setMessage(null);

    const promptSuggestionRequestId = promptSuggestionRequestRef.current + 1;
    promptSuggestionRequestRef.current = promptSuggestionRequestId;

    try {
      const result = await fetch("/api/forms/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const payload = await result.json() as { form?: ImportedForm; error?: { message?: string } };
      if (!result.ok || !payload.form) throw new Error(payload.error?.message ?? "폼을 분석하지 못했습니다.");
      setForm(payload.form);
      setAnalyzedUrl(url.trim());
      setRules(createDefaultRules(payload.form));
      setResponses([]);
      setSubmission(null);
      setSelectedQuestionIndex(0);
      setSelectedResponseIndex(0);
      setWorkspaceTab("questions");
      editedPromptIdsRef.current = new Set();
      setTextGenerationModes(Object.fromEntries(
        payload.form.questions
          .filter(isConfigurableTextQuestion)
          .map((question) => [question.id, hasStructuredTextRule(question) ? "rules" : "ai"] as const),
      ));
      setAiPrompts(Object.fromEntries(
        payload.form.questions
          .filter(isConfigurableTextQuestion)
          .map((question) => [question.id, defaultAiPrompt(question)]),
      ));
      void loadPromptSuggestions(payload.form, promptSuggestionRequestId);
      setRuleIssue(null);
      setMessage(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "폼을 분석하지 못했습니다.");
    } finally {
      setAnalyzing(false);
    }
  }

  function updateRule(next: GenerationRule) {
    setRules((current) => current.map((rule) => rule.questionId === next.questionId ? next : rule));
    if (ruleIssue?.questionId === next.questionId) setRuleIssue(null);
    setResponses([]);
    setSubmission(null);
    setWorkspaceTab("questions");
  }

  function updateTextSource(questionId: string, source: TextGenerationMode) {
    setTextGenerationModes((current) => ({ ...current, [questionId]: source }));
    if (ruleIssue?.questionId === questionId) setRuleIssue(null);
    setResponses([]);
    setSubmission(null);
    setWorkspaceTab("questions");
  }

  function updateAiPrompt(questionId: string, prompt: string) {
    editedPromptIdsRef.current.add(questionId);
    setAiPrompts((current) => ({ ...current, [questionId]: prompt }));
    setResponses([]);
    setSubmission(null);
    setWorkspaceTab("questions");
  }

  async function rulesWithAiAnswers(requestedCount: number): Promise<{
    rules: GenerationRule[];
    fallbackCount: number;
  }> {
    if (!form) return { rules, fallbackCount: 0 };
    const textQuestions = form.questions.filter(isConfigurableTextQuestion);
    const aiSampleCount = Math.min(requestedCount, 100);
    let fallbackCount = 0;
    let nextRules = rules.map((rule) => {
      if (rule.kind === "text") {
        const source = textGenerationModes[rule.questionId] ?? "ai";
        return {
          ...rule,
          samples: source === "manual" ? nonEmptyLines(rule.samples) : [],
        };
      }
      return rule.kind === "choice" || rule.kind === "checkboxes"
        ? {
            ...rule,
            other: rule.other ? { ...rule.other, samples: nonEmptyLines(rule.other.samples) } : undefined,
          }
        : rule;
    });

    for (let index = 0; index < textQuestions.length; index += 1) {
      const question = textQuestions[index];
      const currentRule = nextRules.find((rule) => rule.questionId === question.id);
      if (!currentRule || currentRule.kind !== "text" || !currentRule.enabled) continue;
      if ((textGenerationModes[question.id] ?? "ai") !== "ai") continue;
      setMessage(`AI 응답 생성 중 (${index + 1}/${textQuestions.length})`);
      const constraints = constraintsForQuestion(question);
      try {
        const result = await fetch("/api/ai/generate-text", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: {
              id: question.id,
              type: question.type,
              title: question.title,
              description: question.description,
              required: question.required,
              ...(constraints.minLength !== undefined ? { minLength: constraints.minLength } : {}),
              ...(constraints.maxLength !== undefined ? { maxLength: constraints.maxLength } : {}),
              textKind: constraints.textKind,
              ...(constraints.minValue !== undefined ? { minValue: constraints.minValue } : {}),
              ...(constraints.maxValue !== undefined ? { maxValue: constraints.maxValue } : {}),
              ...(constraints.excludedNumberRange ? { excludedNumberRange: constraints.excludedNumberRange } : {}),
              ...(constraints.pattern ? { pattern: constraints.pattern } : {}),
            },
            count: aiSampleCount,
            existingAnswers: [],
            locale: form.locale || "ko",
            prompt: aiPrompts[question.id]?.trim() || undefined,
          }),
        });
        const payload = await result.json() as { answers?: string[]; error?: { message?: string } };
        if (!result.ok || !payload.answers?.length) {
          throw new Error(payload.error?.message ?? `“${question.title}” 문구를 생성하지 못했습니다.`);
        }
        nextRules = nextRules.map((rule) => rule.questionId === question.id && rule.kind === "text"
          ? { ...rule, mode: "sequence", samples: payload.answers! }
          : rule);
      } catch {
        fallbackCount += 1;
      }
    }

    return { rules: nextRules, fallbackCount };
  }

  async function generate() {
    if (!form || busy || formIsStale) return;
    const requestedCount = Math.max(1, Math.min(500, Math.floor(count || 1)));

    for (const question of form.questions) {
      const rule = ruleMap.get(question.id);
      if (!rule?.enabled) continue;
      if (
        rule.kind === "text" &&
        textGenerationModes[question.id] === "manual" &&
        nonEmptyLines(rule.samples).length === 0
      ) {
        const issue = {
          questionId: question.id,
          fieldId: `text-pool-${question.id}`,
          message: "직접 입력 문구를 한 줄 이상 입력해 주세요.",
        };
        setRuleIssue(issue);
        requestAnimationFrame(() => document.getElementById(issue.fieldId)?.focus());
        return;
      }
      if (rule.kind === "text" && textGenerationModes[question.id] === "manual") {
        const invalidSample = nonEmptyLines(rule.samples)
          .find((sample) => !matchesTextConstraints(question, sample));
        if (invalidSample) {
          const issue = {
            questionId: question.id,
            fieldId: `text-pool-${question.id}`,
            message: `문항 조건에 맞지 않는 응답이 있습니다: ${invalidSample}`,
          };
          setRuleIssue(issue);
          requestAnimationFrame(() => document.getElementById(issue.fieldId)?.focus());
          return;
        }
      }
      if (
        (rule.kind === "choice" || rule.kind === "checkboxes") &&
        rule.other?.enabled &&
        (rule.kind !== "choice" || rule.mode !== "fixed") &&
        usableOtherLines(question, rule.other.samples).length === 0
      ) {
        const issue = {
          questionId: question.id,
          fieldId: `other-pool-${question.id}`,
          message: "기존 선택지와 다른 기타 응답 문구를 한 줄 이상 입력해 주세요.",
        };
        setRuleIssue(issue);
        requestAnimationFrame(() => document.getElementById(issue.fieldId)?.focus());
        return;
      }
    }

    setCount(requestedCount);
    setRuleIssue(null);
    setGenerating(true);
    setError(null);
    setMessage("응답 생성 중");
    setResponses([]);
    setSubmission(null);
    promptSuggestionRequestRef.current += 1;

    try {
      const prepared = await rulesWithAiAnswers(requestedCount);
      const seed = `${form.source.publicId}:${Date.now()}:${crypto.randomUUID()}`;
      const generated = generateResponses({ form, rules: prepared.rules, count: requestedCount, seed });
      setResponses(generated);
      setWorkspaceTab("summary");
      setSelectedQuestionIndex(0);
      setSelectedResponseIndex(0);
      setMessage(prepared.fallbackCount > 0
        ? `${generated.length}개 응답 생성 완료 · AI ${prepared.fallbackCount}개 기본 생성으로 대체`
        : `${generated.length}개 응답 생성 완료`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "응답을 생성하지 못했습니다.");
      setMessage(null);
    } finally {
      setGenerating(false);
    }
  }

  async function submitSequentially() {
    if (!form || responses.length === 0 || busy || formIsStale) return;
    const formTitle = form.title || "제목 없는 설문지";
    if (!window.confirm(`“${formTitle}”에 ${responses.length}개 응답을 실제로 순차 제출합니다. 계속할까요?`)) return;

    setSubmitting(true);
    setError(null);
    setMessage("실제 제출 중");
    let accepted = 0;
    let failed = 0;
    setSubmission({ done: 0, accepted: 0, failed: 0, error: null });

    for (let index = 0; index < responses.length; index += 1) {
      try {
        const result = await fetch("/api/forms/submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: form.source.canonicalUrl, response: responses[index] }),
        });
        const payload = await result.json() as { accepted?: boolean; error?: { message?: string } };
        if (!result.ok || !payload.accepted) throw new Error(payload.error?.message ?? "응답 제출이 거부되었습니다.");
        accepted += 1;
        setSubmission({ done: index + 1, accepted, failed, error: null });
      } catch (caught) {
        failed += 1;
        const reason = caught instanceof Error ? caught.message : "응답을 제출하지 못했습니다.";
        setSubmission({ done: index + 1, accepted, failed, error: reason });
        setError(`${index + 1}번째 응답에서 제출을 중단했습니다: ${reason}`);
        setMessage(null);
        break;
      }
    }

    if (failed === 0) setMessage(`${accepted}개 응답 제출 완료`);
    setSubmitting(false);
  }

  const skippedItems = form?.diagnostics.skippedItems ?? [];

  return (
    <main className={`workbench ${hasLaunched ? "is-workspace" : "is-idle"}${analyzing ? " is-analyzing" : ""}`}>
      <div className="brand-stage" aria-hidden={hasLaunched}>
        <div className="brand-clip">
          <h1 className="brand-wordmark" aria-label="Form Swarm">
            <span>FORM</span>
            <span>SWARM</span>
          </h1>
        </div>
      </div>

      <header className="search-region">
        <div className={`header-primary${form ? " has-form" : ""}`}>
          {form && (
            <div className="header-identity">
              <strong>FORM SWARM</strong>
              <span title={form.title || "제목 없는 설문지"}>{form.title || "제목 없는 설문지"}</span>
            </div>
          )}

          <form className="import-form" onSubmit={analyzeForm} aria-busy={analyzing}>
            <label className="sr-only" htmlFor="form-url">Google Forms 링크</label>
            <input
              id="form-url"
              type="url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setError(null);
                setMessage(null);
                setRuleIssue(null);
              }}
              placeholder="Google Forms 링크"
              maxLength={2_048}
              disabled={busy}
              required
            />
            <button
              type="submit"
              aria-label={analyzing ? "Google Forms 분석 중" : "Google Forms 검색"}
              disabled={busy}
            >
              <Search aria-hidden="true" size={17} strokeWidth={2.2} />
              <span>{analyzing ? "분석 중" : "검색"}</span>
            </button>
          </form>

          {form && (
            <div className="workspace-actions">
              <form
                className="generation-control"
                aria-busy={generating}
                onSubmit={(event) => {
                  event.preventDefault();
                  void generate();
                }}
              >
                <label className="sr-only" htmlFor="response-count">생성 개수</label>
                <input
                  id="response-count"
                  type="number"
                  min={1}
                  max={500}
                  required
                  value={count}
                  placeholder="생성 개수"
                  disabled={busy || formIsStale}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setCount(nextValue === "" ? "" : Number(nextValue));
                  }}
                />
                <button
                  className="toolbar-generate"
                  type="submit"
                  disabled={busy || formIsStale || count === "" || count < 1 || count > 500}
                >
                  <Sparkles aria-hidden="true" size={17} strokeWidth={2.2} />
                  <span className="action-label--wide">{generating ? "생성 중" : "응답 생성"}</span>
                  <span className="action-label--compact">{generating ? "생성 중" : "생성"}</span>
                </button>
              </form>
              <button
                className="toolbar-submit-button"
                type="button"
                aria-label={responses.length > 0 ? `${responses.length}개 응답 실제 제출` : "실제 제출"}
                disabled={busy || formIsStale || responses.length === 0 || !allResponsesValid}
                onClick={() => void submitSequentially()}
              >
                <Send aria-hidden="true" size={17} strokeWidth={2.2} />
                <span className="action-label--wide">
                  {submitting
                    ? `제출 ${submission?.done ?? 0}/${responses.length}`
                    : responses.length > 0
                      ? `${responses.length}개 실제 제출`
                      : "실제 제출"}
                </span>
                <span className="action-label--compact">
                  {submitting
                    ? `${submission?.done ?? 0}/${responses.length}`
                    : responses.length > 0
                      ? `${responses.length}개 제출`
                      : "제출"}
                </span>
                <span className="action-label--narrow">제출</span>
              </button>
            </div>
          )}
        </div>

        {form && (
          <div className="workspace-nav-row">
            <div
              className="workspace-tabs"
              role="tablist"
              aria-label="작업 화면"
              onKeyDown={handleWorkspaceTabKeyDown}
            >
              {([
                ["questions", "문항"],
                ["summary", "요약"],
                ["question", "문항별"],
                ["individual", "개별 응답"],
              ] as const).map(([tab, label]) => {
                const responseTab = tab !== "questions";
                const disabled = responseTab && responses.length === 0;
                return (
                  <button
                    id={`workspace-tab-${tab}`}
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={workspaceTab === tab}
                    aria-controls={`workspace-panel-${tab}`}
                    tabIndex={workspaceTab === tab ? 0 : -1}
                    disabled={disabled}
                    onClick={() => selectWorkspaceTab(tab)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {(generating || submitting || message) && (
          <p className="sr-only" role="status" aria-live="polite">
            {submitting
              ? `응답 제출 중 ${submission?.done ?? 0}/${responses.length}`
              : message}
          </p>
        )}
      </header>

      {(error || formIsStale || (!form && message)) && (
        <div className="status-region">
          {error ? (
            <p className="message error" role="alert">{error}</p>
          ) : formIsStale ? (
            <p className="message stale" role="status">입력한 링크가 현재 분석 결과와 다릅니다. 검색한 뒤 생성하거나 제출할 수 있습니다.</p>
          ) : !form && message ? (
            <p className="message success" role="status" aria-live="polite">{message}</p>
          ) : null}
        </div>
      )}

      {form && (
        <section
          className="analysis"
          key={`${form.source.publicId}:${form.source.fetchedAt}`}
          aria-label="Google Forms 분석 결과"
          aria-busy={analyzing}
        >
          {workspaceTab !== "individual" && (
            <div className="form-heading" id="form-overview">
              <h1>{form.title || "제목 없는 설문지"}</h1>
              {form.description && <p>{form.description}</p>}
            </div>
          )}

          {workspaceTab === "questions" && (
            <div
              className="workspace-view questions-workspace"
              id="workspace-panel-questions"
              role="tabpanel"
              aria-labelledby="workspace-tab-questions"
            >
              <fieldset className="item-list analysis-fields" disabled={busy || formIsStale}>
                <legend className="sr-only">문항별 응답 생성 설정</legend>
                {form.sections.map((section) => (
                  <FormSectionGroup key={section.id} section={section}>
                    {(itemsBySection.get(section.id) ?? []).map((item) => {
                      if ("kind" in item && item.kind !== "question") {
                        return <ContentView key={`${item.kind}:${item.id}`} item={item} />;
                      }
                      return (
                        <QuestionView
                          key={item.id}
                          question={item}
                          rule={ruleMap.get(item.id)}
                          textSource={isConfigurableTextQuestion(item)
                            ? (textGenerationModes[item.id] ?? (hasStructuredTextRule(item) ? "rules" : "ai"))
                            : "rules"}
                          aiPrompt={aiPrompts[item.id] ?? ""}
                          onTextSourceChange={(source) => updateTextSource(item.id, source)}
                          onAiPromptChange={(prompt) => updateAiPrompt(item.id, prompt)}
                          onRuleChange={updateRule}
                          issue={ruleIssue?.questionId === item.id ? ruleIssue : undefined}
                        />
                      );
                    })}
                  </FormSectionGroup>
                ))}
              </fieldset>

              {skippedItems.length > 0 && (
                <section className="excluded-items" aria-labelledby="excluded-items-heading">
                  <h2 className="excluded-heading" id="excluded-items-heading">제외된 항목</h2>
                  <div className="item-list">
                    {skippedItems.map((item) => (
                      <article className="content-item" key={item.itemId}>
                        {item.title && <h3>{item.title}</h3>}
                        <InfoDetails>
                          <dt>Google Forms API</dt><dd>Item.questionItem → Question.fileUploadQuestion</dd>
                          <dt>SkippedFormItem.itemId</dt><dd>{item.itemId}</dd>
                          <dt>SkippedFormItem.rawType</dt><dd>{item.rawType}</dd>
                          <dt>SkippedFormItem.reason</dt><dd>{item.reason}</dd>
                        </InfoDetails>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {responses.length > 0 && workspaceTab === "summary" && (
            <div
              className="workspace-view summary-list"
              id="workspace-panel-summary"
              role="tabpanel"
              aria-labelledby="workspace-tab-summary"
            >
              {form.questions.map((question) => (
                <ResponseSummaryCard key={question.id} question={question} responses={responses} />
              ))}
            </div>
          )}

          {responses.length > 0 && workspaceTab === "question" && selectedQuestion && (
            <div
              className="workspace-view question-preview"
              id="workspace-panel-question"
              role="tabpanel"
              aria-labelledby="workspace-tab-question"
            >
              <div className="preview-navigator-bar">
                <label className="question-picker">
                  <span className="sr-only">문항 선택</span>
                  <select
                    value={selectedQuestion.id}
                    onChange={(event) => setSelectedQuestionIndex(
                      Math.max(0, form.questions.findIndex((question) => question.id === event.target.value)),
                    )}
                  >
                    {form.questions.map((question) => (
                      <option key={question.id} value={question.id}>{question.title}</option>
                    ))}
                  </select>
                </label>
                <ResponseNavigator
                  label="문항"
                  index={selectedQuestionIndex}
                  total={form.questions.length}
                  onChange={setSelectedQuestionIndex}
                />
              </div>
              <QuestionResponsePanel question={selectedQuestion} responses={responses} />
            </div>
          )}

          {responses.length > 0 && workspaceTab === "individual" && selectedResponse && (
            <div
              className="workspace-view individual-preview"
              id="workspace-panel-individual"
              role="tabpanel"
              aria-labelledby="workspace-tab-individual"
            >
              <div className="preview-navigator-bar preview-navigator-bar--individual">
                <ResponseNavigator
                  label="응답"
                  index={selectedResponseIndex}
                  total={responses.length}
                  onChange={setSelectedResponseIndex}
                />
              </div>
              <IndividualResponsePanel
                form={form}
                response={selectedResponse}
                valid={validationResults[selectedResponseIndex]?.valid ?? false}
              />
            </div>
          )}

          {responses.length > 0 && (!allResponsesValid || submission) && (
            <section className="submission-feedback" aria-label="실제 제출 상태">
              {!allResponsesValid && <p className="message error">유효하지 않은 응답이 있어 제출할 수 없습니다.</p>}
              {submission && (
                <>
                  <div
                    className="submission-progress"
                    role="progressbar"
                    aria-label="응답 제출 진행률"
                    aria-valuemin={0}
                    aria-valuemax={responses.length}
                    aria-valuenow={submission.done}
                  >
                    <i style={{ "--chart-value": `${(submission.done / responses.length) * 100}%` } as React.CSSProperties} />
                  </div>
                  <div className="submission-results">
                    <span>처리 {submission.done}/{responses.length}</span>
                    <span>성공 {submission.accepted}</span>
                    <span>실패 {submission.failed}</span>
                  </div>
                </>
              )}
            </section>
          )}
        </section>
      )}
    </main>
  );
}
