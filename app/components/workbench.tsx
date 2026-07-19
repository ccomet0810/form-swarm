"use client";

/* eslint-disable @next/next/no-img-element */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Circle, Heart, Star, ThumbsUp } from "lucide-react";
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
import { validateGeneratedResponse } from "../../lib/generator/validation";
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

type TextGenerationMode = "ai" | "manual";
type TextSource = TextGenerationMode | "rules";
type DisplayFormItem = FormQuestion | Exclude<FormItem, { kind: "section" }>;

function nonEmptyLines(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function defaultAiPrompt(question: FormQuestion): string {
  return question.type === "paragraph"
    ? "문항의 의도와 설명을 반영해 자연스럽고 구체적인 서술형 응답을 서로 다르게 생성해 주세요."
    : "문항의 의도와 설명을 반영해 자연스럽고 간결한 단답형 응답을 서로 다르게 생성해 주세요.";
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
    if (textSource === "rules") {
      return (
        <div className="rule-editor compact-rule-editor">
          <div className="static-rule-field">
            <span>생성 방식</span>
            <strong>{ruleGeneratedTextLabel(question)}</strong>
          </div>
        </div>
      );
    }

    const fieldId = `text-pool-${question.id}`;
    return (
      <div className="rule-editor">
        <label>
          생성 방식
          <select
            value={textSource}
            onChange={(event) => onTextSourceChange(event.target.value as TextGenerationMode)}
          >
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

function needsAiText(question: FormQuestion): boolean {
  if (question.type === "paragraph") return true;
  if (question.type !== "short_text") return false;
  const constraints = constraintsForQuestion(question);
  if (
    constraints.textKind !== "plain" ||
    constraints.minValue !== undefined ||
    constraints.maxValue !== undefined ||
    constraints.excludedNumberRange
  ) {
    return false;
  }
  return true;
}

export function Workbench() {
  const [url, setUrl] = useState("");
  const [analyzedUrl, setAnalyzedUrl] = useState<string | null>(null);
  const [form, setForm] = useState<ImportedForm | null>(null);
  const [rules, setRules] = useState<GenerationRule[]>([]);
  const [responses, setResponses] = useState<GeneratedResponse[]>([]);
  const [count, setCount] = useState(10);
  const [analyzing, setAnalyzing] = useState(false);
  const [hasLaunched, setHasLaunched] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<"summary" | "individual">("summary");
  const [submission, setSubmission] = useState<SubmissionProgress | null>(null);
  const [textGenerationModes, setTextGenerationModes] = useState<Record<string, TextGenerationMode>>({});
  const [aiPrompts, setAiPrompts] = useState<Record<string, string>>({});
  const [ruleIssue, setRuleIssue] = useState<RuleIssue | null>(null);
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

  async function analyzeForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim() || busy) return;
    setHasLaunched(true);
    setAnalyzing(true);
    setError(null);
    setMessage(null);

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
      setTextGenerationModes(Object.fromEntries(
        payload.form.questions
          .filter(needsAiText)
          .map((question) => [question.id, "ai"] as const),
      ));
      setAiPrompts(Object.fromEntries(
        payload.form.questions
          .filter(needsAiText)
          .map((question) => [question.id, defaultAiPrompt(question)]),
      ));
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
  }

  function updateTextSource(questionId: string, source: TextGenerationMode) {
    setTextGenerationModes((current) => ({ ...current, [questionId]: source }));
    if (ruleIssue?.questionId === questionId) setRuleIssue(null);
    setResponses([]);
    setSubmission(null);
  }

  function updateAiPrompt(questionId: string, prompt: string) {
    setAiPrompts((current) => ({ ...current, [questionId]: prompt }));
    setResponses([]);
    setSubmission(null);
  }

  async function rulesWithAiAnswers(requestedCount: number): Promise<GenerationRule[]> {
    if (!form) return rules;
    const textQuestions = form.questions.filter(needsAiText);
    const aiSampleCount = Math.min(requestedCount, 100);
    let nextRules = rules.map((rule) => rule.kind === "text"
      ? { ...rule, samples: nonEmptyLines(rule.samples) }
      : rule.kind === "choice" || rule.kind === "checkboxes"
        ? {
            ...rule,
            other: rule.other ? { ...rule.other, samples: nonEmptyLines(rule.other.samples) } : undefined,
          }
        : rule);

    for (let index = 0; index < textQuestions.length; index += 1) {
      const question = textQuestions[index];
      const currentRule = nextRules.find((rule) => rule.questionId === question.id);
      if (!currentRule || currentRule.kind !== "text" || !currentRule.enabled) continue;
      if ((textGenerationModes[question.id] ?? "ai") !== "ai") continue;
      setMessage(`주관식 문구 생성 중 (${index + 1}/${textQuestions.length})`);
      const constraints = constraintsForQuestion(question);
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
            ...(constraints.minLength ? { minLength: constraints.minLength } : {}),
            ...(constraints.maxLength ? { maxLength: constraints.maxLength } : {}),
          },
          count: aiSampleCount,
          existingAnswers: currentRule.samples.slice(0, 100),
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
    }

    return nextRules;
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

    try {
      const nextRules = await rulesWithAiAnswers(requestedCount);
      const seed = `${form.source.publicId}:${Date.now()}:${crypto.randomUUID()}`;
      const generated = generateResponses({ form, rules: nextRules, count: requestedCount, seed });
      setResponses(generated);
      setPreviewTab("summary");
      setMessage(`${generated.length}개 응답 생성 완료`);
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

      <div className="search-region">
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
          <button type="submit" disabled={busy}>{analyzing ? "분석 중" : "검색"}</button>
        </form>
      </div>

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
          <div className="form-heading" id="form-overview">
            <h1>{form.title || "제목 없는 설문지"}</h1>
            {form.description && <p>{form.description}</p>}
          </div>

          <div className="result-layout">
            <aside className="result-nav">
              <nav aria-label="분석 결과 바로가기">
                <p>바로가기</p>
                <a href="#analysis-items">문항 및 콘텐츠</a>
                {form.sections.length > 1 && (
                  <div className="section-links">
                    {form.sections.map((section) => {
                      const firstQuestionId = section.questionIds[0];
                      const target = section.itemId
                        ? `#item-${section.itemId}`
                        : firstQuestionId
                          ? `#question-${firstQuestionId}`
                          : "#analysis-items";
                      return <a key={section.id} href={target}>{section.title || `섹션 ${section.index + 1}`}</a>;
                    })}
                  </div>
                )}
                <a href="#response-generation">응답 생성</a>
                {responses.length > 0 && <a href="#response-preview">미리보기</a>}
                {responses.length > 0 && <a href="#response-submit">실제 제출</a>}
              </nav>
            </aside>

            <div className="result-main">
              <section className="workflow-section analysis-section" id="analysis-items">
                <div className="workflow-heading">
                  <h2>문항 및 콘텐츠</h2>
                </div>
                <fieldset className="item-list analysis-fields" disabled={busy || formIsStale}>
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
                            textSource={!needsAiText(item) ? "rules" : (textGenerationModes[item.id] ?? "ai")}
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
              </section>

              {skippedItems.length > 0 && (
                <section className="workflow-section excluded-section">
                  <div className="workflow-heading"><h2>제외된 항목</h2></div>
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

              <section className="workflow-section generation-panel" id="response-generation">
                <div className="workflow-heading">
                  <h2>응답 생성</h2>
                </div>
                <div className="generation-controls">
                  <label htmlFor="response-count">
                    생성 개수
                    <input id="response-count" type="number" min={1} max={500} value={count} disabled={busy || formIsStale} onChange={(event) => setCount(Number(event.target.value))} />
                  </label>
                  <button className="primary-button" type="button" disabled={busy || formIsStale} onClick={() => void generate()}>
                    {generating ? "생성 중" : "응답 생성"}
                  </button>
                </div>
                {(generating || responses.length > 0) && (
                  <p className="generation-status" aria-live="polite">
                    {generating ? (message ?? "응답 생성 중") : `${responses.length}개 응답 생성 완료`}
                  </p>
                )}
              </section>

              {responses.length > 0 && (
                <section className="workflow-section preview-panel" id="response-preview">
                  <div className="workflow-heading">
                    <h2>미리보기</h2>
                  </div>
                  <div className="preview-tabs" aria-label="미리보기 방식">
                    <button type="button" aria-pressed={previewTab === "summary"} onClick={() => setPreviewTab("summary")}>요약</button>
                    <button type="button" aria-pressed={previewTab === "individual"} onClick={() => setPreviewTab("individual")}>개별 응답</button>
                  </div>

                  {previewTab === "summary" ? (
                    <div className="summary-list">
                      {form.questions.map((question) => <ResponseSummaryCard key={question.id} question={question} responses={responses} />)}
                    </div>
                  ) : (
                    <div className="individual-list">
                      {responses.map((response, index) => (
                        <details className="individual-response" key={response.id} open={index === 0}>
                          <summary>응답 {index + 1}{validationResults[index]?.valid ? "" : " (검토 필요)"}</summary>
                          <dl className="answer-list">
                            {form.questions.map((question) => (
                              <div key={question.id} className="answer-pair">
                                <dt>{question.title}</dt>
                                <dd>{answerLabel(response.answers[question.id])}</dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {responses.length > 0 && (
                <section className="workflow-section submission-panel" id="response-submit">
                  <div className="workflow-heading">
                    <h2>실제 제출</h2>
                  </div>
                  {!allResponsesValid && <p className="message error">유효하지 않은 응답이 있어 제출할 수 없습니다.</p>}
                  <button
                    className="submit-button"
                    type="button"
                    disabled={busy || formIsStale || !allResponsesValid}
                    onClick={() => void submitSequentially()}
                  >
                    {submitting ? "제출 중" : `${responses.length}개 순차 제출`}
                  </button>
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
                      {submission.error && <p className="message error">{submission.error}</p>}
                    </>
                  )}
                </section>
              )}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
