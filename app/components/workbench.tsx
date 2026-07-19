"use client";

/* eslint-disable @next/next/no-img-element */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  FormImageRef,
  FormItem,
  FormNavigationTarget,
  FormQuestion,
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

const TYPE_LABEL: Record<QuestionType, string> = {
  short_text: "단답형",
  paragraph: "장문형",
  single_choice: "객관식",
  dropdown: "드롭다운",
  checkboxes: "체크박스",
  scale: "선형 배율",
  grid_single: "객관식 그리드",
  grid_checkbox: "체크박스 그리드",
  rating: "등급",
  date: "날짜",
  time: "시간",
  unknown: "미지원 유형",
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

function nonEmptyLines(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
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
}: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  ariaDescribedBy?: string;
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
      onChange={(event) => onValueChange(event.target.value)}
    />
  );
}

function TechnicalDetails({ children }: { children: React.ReactNode }) {
  return (
    <details className="technical-details">
      <summary>기술 정보</summary>
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

function navigationLabel(target: FormNavigationTarget | null | undefined): string {
  if (!target || target.kind === "next") return "다음 섹션";
  if (target.kind === "submit") return "양식 제출";
  if (target.kind === "section") return `섹션 ${target.sectionItemId}`;
  return `알 수 없음 (${target.rawValue})`;
}

function validationLabel(validation: FormValidation): string {
  if (validation.kind === "number_range") {
    return `${validation.operator === "between" ? "숫자 범위" : "숫자 범위 제외"}: ${validation.min} ~ ${validation.max}${validation.errorMessage ? ` / ${validation.errorMessage}` : ""}`;
  }
  if (validation.kind === "text_length") {
    return `글자 수 ${validation.operator === "min" ? "최소" : "최대"} ${validation.value}${validation.errorMessage ? ` / ${validation.errorMessage}` : ""}`;
  }
  return `선택 수 ${validation.operator === "exact" ? "정확히" : validation.operator === "min" ? "최소" : "최대"} ${validation.value}${validation.errorMessage ? ` / ${validation.errorMessage}` : ""}`;
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
  const noteId = `other-pool-note-${question.id}`;

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
              ariaDescribedBy={issue?.fieldId === fieldId ? `${noteId} ${fieldId}-error` : noteId}
              onValueChange={(value) => onChange({
                ...rule,
                other: { ...other, samples: value.split(/\r?\n/) },
              })}
            />
          </label>
          <p className="field-note" id={noteId}>
            한 줄이 응답 하나입니다. 사용 가능한 문구 {usableOtherLines(question, other.samples).length}개
          </p>
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
  onTextSourceChange,
  onChange,
  issue,
}: {
  question: FormQuestion;
  rule: GenerationRule | undefined;
  textSource: "ai" | "manual" | "rules";
  onTextSourceChange: (source: "ai" | "manual") => void;
  onChange: (next: GenerationRule) => void;
  issue?: RuleIssue;
}) {
  if (!rule || rule.kind === "unsupported") {
    return <div className="rule-editor"><p className="rule-heading">생성 설정</p><span>자동 생성 제외</span></div>;
  }

  if (question.type === "date" || question.type === "time") {
    return (
      <div className="rule-editor">
        <p className="rule-heading">생성 설정</p>
        <span>{question.type === "date" ? "날짜 자동 생성" : "시간 자동 생성"}</span>
      </div>
    );
  }

  if (rule.kind === "text") {
    if (textSource === "rules") {
      return (
        <div className="rule-editor compact-rule-editor">
          <p className="rule-heading">생성 설정</p>
          <p className="rule-note">검증 조건에 맞춰 자동으로 생성합니다.</p>
        </div>
      );
    }

    const fieldId = `text-pool-${question.id}`;
    const noteId = `text-pool-note-${question.id}`;
    return (
      <div className="rule-editor">
        <p className="rule-heading">생성 설정</p>
        <label>
          생성 방식
          <select
            value={textSource}
            onChange={(event) => onTextSourceChange(event.target.value as "ai" | "manual")}
          >
            <option value="ai">AI 자동 생성</option>
            <option value="manual">직접 입력 목록</option>
          </select>
        </label>
        {textSource === "ai" ? (
          <p className="rule-note">응답 생성 버튼을 누를 때 문항에 맞는 문구를 새로 만듭니다.</p>
        ) : (
          <>
            <label className="wide-field" htmlFor={fieldId}>
              응답 문구
              <AutoGrowTextarea
                id={fieldId}
                value={rule.samples.join("\n")}
                ariaDescribedBy={issue?.fieldId === fieldId ? `${noteId} ${fieldId}-error` : noteId}
                onValueChange={(value) => onChange({
                  ...rule,
                  mode: "sample_pool",
                  samples: value.split(/\r?\n/),
                })}
              />
            </label>
            <p className="field-note" id={noteId}>
              한 줄이 응답 하나입니다. 생성할 때 목록에서 무작위로 선택합니다. 사용 가능한 문구 {nonEmptyLines(rule.samples).length}개
            </p>
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
        <p className="rule-heading">생성 설정</p>
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
        <p className="rule-heading">생성 설정</p>
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
      <p className="rule-heading">생성 설정</p>
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
  onTextSourceChange,
  onRuleChange,
  issue,
}: {
  question: FormQuestion;
  rule: GenerationRule | undefined;
  textSource: "ai" | "manual" | "rules";
  onTextSourceChange: (source: "ai" | "manual") => void;
  onRuleChange: (next: GenerationRule) => void;
  issue?: RuleIssue;
}) {
  return (
    <article className="question-item" id={`question-${question.id}`}>
      <div className="question-title-row">
        <h3>{question.title || "제목 없음"}</h3>
      </div>

      <p className="item-byline">
        <span>유형: {TYPE_LABEL[question.type]}</span>
        <span>필수: {question.required ? "O" : "X"}</span>
      </p>

      {question.description && <p className="question-description">{question.description}</p>}

      {(question.images ?? []).map((image) => <ImageView key={image.sourceId} image={image} />)}

      {question.options.length > 0 && (
        <div className="choice-list">
          <p className="content-label">선택지</p>
          <ol className="options" aria-label={`${question.title} 선택지`}>
          {question.options.map((option, index) => (
            <li className="option" key={`${option.index ?? index}:${option.value}`}>
              <div>
                <span>{option.isOther ? "기타 (직접 입력)" : option.label}</span>
                {option.image && <ImageView image={option.image} />}
              </div>
            </li>
          ))}
          </ol>
        </div>
      )}

      {question.grid && (
        <div className="grid-table-wrap">
          <p className="content-label">행과 열</p>
          <table className="grid-table">
            <caption className="sr-only">{question.title}의 행과 열</caption>
            <thead>
              <tr>
                <th>행</th>
                {question.grid.columns.map((column) => <th key={column.id}>{column.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {question.grid.rows.map((row) => (
                <tr key={row.id}>
                  <th>{row.label}</th>
                  {question.grid?.columns.map((column) => <td key={column.id}>선택</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="message">
            행별 응답 {question.grid.requireResponsePerRow ? "필수" : "선택"}
            {question.grid.limitOneResponsePerColumn ? " / 열당 하나만 선택" : ""}
          </p>
        </div>
      )}

      <RuleEditor
        question={question}
        rule={rule}
        textSource={textSource}
        onTextSourceChange={onTextSourceChange}
        onChange={onRuleChange}
        issue={issue}
      />

      <TechnicalDetails>
        <dt>item ID</dt><dd>{question.itemId}</dd>
        <dt>entry ID</dt>
        <dd>{question.entryIds.length > 0 ? question.entryIds.map((id) => <div key={id}>{id}</div>) : "없음"}</dd>
        <dt>section ID</dt><dd>{question.sectionId}</dd>
        <dt>원본 유형</dt><dd>{question.rawType}</dd>
        {(question.validations ?? []).length > 0 && (
          <><dt>응답 검증</dt><dd>{question.validations?.map((validation, index) => <div key={`${validation.kind}-${index}`}>{validationLabel(validation)}</div>)}</dd></>
        )}
        {question.scale && (
          <><dt>배율</dt><dd>{question.scale.min} ~ {question.scale.max} / 낮은 값: {question.scale.lowLabel ?? "없음"} / 높은 값: {question.scale.highLabel ?? "없음"}</dd></>
        )}
        {question.rating && (
          <><dt>등급</dt><dd>{question.rating.min} ~ {question.rating.max} / 표시: {question.rating.icon}</dd></>
        )}
        {question.date && (
          <><dt>날짜 옵션</dt><dd>연도 {question.date.includeYear ? "포함" : "제외"}, 시간 {question.date.includeTime ? "포함" : "제외"}</dd></>
        )}
        {question.time && (
          <><dt>시간 옵션</dt><dd>{question.time.kind === "duration" ? "기간" : "시각"}</dd></>
        )}
        {question.options.some((option) => option.value !== option.label || option.branchTarget) && (
          <>
            <dt>선택지 제출값</dt>
            <dd>{question.options.map((option, index) => (
              <div key={`${option.index ?? index}:${option.value}`}>
                {option.label}: {option.value}{option.branchTarget ? ` / ${navigationLabel(option.branchTarget)}` : ""}
              </div>
            ))}</dd>
          </>
        )}
        {question.grid && (
          <>
            <dt>행 entry ID</dt>
            <dd>{question.grid.rows.map((row) => <div key={row.id}>{row.label}: {row.entryId ?? row.id}</div>)}</dd>
            <dt>열 ID</dt>
            <dd>{question.grid.columns.map((column) => <div key={column.id}>{column.label}: {column.id}</div>)}</dd>
          </>
        )}
      </TechnicalDetails>
    </article>
  );
}

function ContentView({ item }: { item: Exclude<FormItem, { kind: "question" }> }) {
  if (item.kind === "section") {
    return (
      <article className="content-item section-item" id={`item-${item.itemId}`}>
        <h3>{item.title || "제목 없는 섹션"}</h3>
        <p className="item-byline"><span>유형: 섹션</span></p>
        {item.description && <p>{item.description}</p>}
        <TechnicalDetails>
          <dt>item ID</dt><dd>{item.itemId}</dd>
          <dt>다음 이동</dt><dd>{navigationLabel(item.navigation)}</dd>
        </TechnicalDetails>
      </article>
    );
  }

  if (item.kind === "text_block") {
    return (
      <article className="content-item" id={`item-${item.itemId}`}>
        <h3>{item.title || "제목 없는 설명"}</h3>
        <p className="item-byline"><span>유형: 제목 및 설명</span></p>
        {item.description && <p>{item.description}</p>}
        <TechnicalDetails><dt>item ID</dt><dd>{item.itemId}</dd></TechnicalDetails>
      </article>
    );
  }

  if (item.kind === "image") {
    return (
      <article className="content-item" id={`item-${item.itemId}`}>
        <h3>{item.title || item.image.altText || "이미지"}</h3>
        <p className="item-byline"><span>유형: 이미지</span></p>
        {item.description && <p>{item.description}</p>}
        <ImageView image={item.image} />
        <TechnicalDetails><dt>item ID</dt><dd>{item.itemId}</dd><dt>이미지 ID</dt><dd>{item.image.sourceId}</dd></TechnicalDetails>
      </article>
    );
  }

  return (
    <article className="content-item" id={`item-${item.itemId}`}>
      <h3>{item.title || "동영상"}</h3>
      <p className="item-byline"><span>유형: 동영상</span></p>
      {item.description && <p>{item.description}</p>}
      <iframe
        className="video-frame"
        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.video.videoId)}`}
        title={item.title || "Google Forms 동영상"}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
      <TechnicalDetails><dt>item ID</dt><dd>{item.itemId}</dd><dt>video ID</dt><dd>{item.video.videoId}</dd></TechnicalDetails>
    </article>
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
  const [manualTextQuestionIds, setManualTextQuestionIds] = useState<Set<string>>(new Set());
  const [ruleIssue, setRuleIssue] = useState<RuleIssue | null>(null);
  const busy = analyzing || generating || submitting;
  const formIsStale = Boolean(form && analyzedUrl !== url.trim());

  const ruleMap = useMemo(() => new Map(rules.map((rule) => [rule.questionId, rule])), [rules]);
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
      setManualTextQuestionIds(new Set());
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

  function updateTextSource(questionId: string, source: "ai" | "manual") {
    setManualTextQuestionIds((current) => {
      const next = new Set(current);
      if (source === "manual") next.add(questionId);
      else next.delete(questionId);
      return next;
    });
    if (ruleIssue?.questionId === questionId) setRuleIssue(null);
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
      if (manualTextQuestionIds.has(question.id)) continue;
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
        manualTextQuestionIds.has(question.id) &&
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
        <form className="import-form" onSubmit={analyzeForm}>
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

      {(error || formIsStale || message) && (
        <div className="status-region">
          {error ? (
            <p className="message error" role="alert">{error}</p>
          ) : formIsStale ? (
            <p className="message stale" role="status">입력한 링크가 현재 분석 결과와 다릅니다. 검색한 뒤 생성하거나 제출할 수 있습니다.</p>
          ) : message ? (
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
              <section className="section-block" id="analysis-items">
                <div className="section-heading">
                  <h2>문항 및 콘텐츠</h2>
                  <p>폼에 표시되는 순서입니다. 선택지와 생성 설정은 문항마다 바로 확인할 수 있습니다.</p>
                </div>
                <fieldset className="item-list analysis-fields" disabled={busy || formIsStale}>
                  {form.items?.map((item) => item.kind === "question" ? (
                    <QuestionView
                      key={`${item.kind}:${item.id}`}
                      question={item}
                      rule={ruleMap.get(item.id)}
                      textSource={!needsAiText(item) ? "rules" : manualTextQuestionIds.has(item.id) ? "manual" : "ai"}
                      onTextSourceChange={(source) => updateTextSource(item.id, source)}
                      onRuleChange={updateRule}
                      issue={ruleIssue?.questionId === item.id ? ruleIssue : undefined}
                    />
                  ) : (
                    <ContentView key={`${item.kind}:${item.id}`} item={item} />
                  )) ?? form.questions.map((question) => (
                    <QuestionView
                      key={question.id}
                      question={question}
                      rule={ruleMap.get(question.id)}
                      textSource={!needsAiText(question) ? "rules" : manualTextQuestionIds.has(question.id) ? "manual" : "ai"}
                      onTextSourceChange={(source) => updateTextSource(question.id, source)}
                      onRuleChange={updateRule}
                      issue={ruleIssue?.questionId === question.id ? ruleIssue : undefined}
                    />
                  ))}
                </fieldset>
              </section>

              {skippedItems.length > 0 && (
                <section className="section-block">
                  <div className="section-heading"><h2>제외된 항목</h2></div>
                  <div className="item-list">
                    {skippedItems.map((item) => (
                      <article className="content-item" key={item.itemId}>
                        <h3>{item.title || "파일 업로드"}</h3>
                        <p className="item-byline"><span>유형: 파일 업로드 · 지원 제외</span></p>
                        <TechnicalDetails>
                          <dt>item ID</dt><dd>{item.itemId}</dd>
                          <dt>원본 유형</dt><dd>{item.rawType}</dd>
                        </TechnicalDetails>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              <section className="generation-panel" id="response-generation">
                <div className="panel-heading">
                  <div><h2>가상 응답 생성</h2><p>문항별 생성 설정을 사용합니다.</p></div>
                </div>
                <label className="generation-label" htmlFor="response-count">생성 개수</label>
                <div className="generation-controls">
                  <input id="response-count" type="number" min={1} max={500} value={count} disabled={busy || formIsStale} onChange={(event) => setCount(Number(event.target.value))} />
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
                <section className="preview-panel" id="response-preview">
                  <div className="panel-heading">
                    <div><h2>미리보기</h2><p>{responses.length}개 응답</p></div>
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
                <section className="submission-panel" id="response-submit">
                  <div className="panel-heading">
                    <div><h2>실제 제출</h2><p>생성된 응답을 한 개씩 Google Forms에 제출합니다. 시작 전에 한 번 더 확인합니다.</p></div>
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
