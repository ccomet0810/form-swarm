"use client";

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";
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
  if (!image.url) {
    return <p className="message">이미지 ID: {image.sourceId} (표시 URL 없음)</p>;
  }
  return (
    <img
      className={className}
      src={image.url}
      alt={image.altText ?? "Google Forms 이미지"}
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      loading="lazy"
    />
  );
}

function RuleEditor({
  question,
  rule,
  onChange,
}: {
  question: FormQuestion;
  rule: GenerationRule | undefined;
  onChange: (next: GenerationRule) => void;
}) {
  if (!rule || rule.kind === "unsupported") {
    return <div className="rule-editor"><span>이 문항은 자동 생성에서 제외됩니다.</span></div>;
  }

  if (question.type === "date" || question.type === "time") {
    return (
      <div className="rule-editor">
        <span>{question.type === "date" ? "유효한 날짜를 자동 생성합니다." : "유효한 시간을 자동 생성합니다."}</span>
      </div>
    );
  }

  if (rule.kind === "text") {
    return (
      <div className="rule-editor">
        <label>
          생성 순서
          <select
            value={rule.mode}
            onChange={(event) => onChange({ ...rule, mode: event.target.value as "sequence" | "sample_pool" })}
          >
            <option value="sample_pool">문구 중 무작위</option>
            <option value="sequence">위에서부터 순서대로</option>
          </select>
        </label>
        <label className="wide-field">
          생성 문구 (한 줄에 하나)
          <textarea
            value={rule.samples.join("\n")}
            onChange={(event) => onChange({
              ...rule,
              samples: event.target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
            })}
          />
        </label>
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
      </div>
    );
  }

  if (rule.kind === "checkboxes") {
    const maximum = Math.max(1, question.options.length);
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
  onRuleChange,
}: {
  question: FormQuestion;
  rule: GenerationRule | undefined;
  onRuleChange: (next: GenerationRule) => void;
}) {
  return (
    <article className="question-item">
      <div className="question-title-row">
        <h3>{question.title || "제목 없음"}</h3>
        <span className="question-type">유형: {TYPE_LABEL[question.type]}</span>
      </div>

      {question.description && <p className="question-description">{question.description}</p>}

      <dl className="question-meta">
        <dt>필수</dt><dd>{question.required ? "O" : "X"}</dd>
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
          <><dt>등급</dt><dd>{question.rating.min} ~ {question.rating.max} / 아이콘: {question.rating.icon}</dd></>
        )}
        {question.date && (
          <><dt>날짜 옵션</dt><dd>연도 {question.date.includeYear ? "포함" : "제외"}, 시간 {question.date.includeTime ? "포함" : "제외"}</dd></>
        )}
        {question.time && (
          <><dt>시간 옵션</dt><dd>{question.time.kind === "duration" ? "기간" : "시각"}</dd></>
        )}
      </dl>

      {(question.images ?? []).map((image) => <ImageView key={image.sourceId} image={image} />)}

      {question.options.length > 0 && (
        <ul className="options" aria-label={`${question.title} 선택지`}>
          {question.options.map((option, index) => (
            <li className="option" key={`${option.index ?? index}:${option.value}`}>
              <span>{index + 1}.</span>
              <div>
                <strong>{option.label}{option.isOther ? " (기타)" : ""}</strong>
                <small>값: {option.value}</small>
                {option.branchTarget && <small>이동: {navigationLabel(option.branchTarget)}</small>}
                {option.image && <ImageView image={option.image} />}
              </div>
            </li>
          ))}
        </ul>
      )}

      {question.grid && (
        <div className="grid-table-wrap">
          <table className="grid-table">
            <thead>
              <tr>
                <th>행 / entry ID</th>
                {question.grid.columns.map((column) => <th key={column.id}>{column.label}<br /><small>{column.id}</small></th>)}
              </tr>
            </thead>
            <tbody>
              {question.grid.rows.map((row) => (
                <tr key={row.id}>
                  <th>{row.label}<br /><small>{row.entryId ?? row.id}</small></th>
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

      <RuleEditor question={question} rule={rule} onChange={onRuleChange} />
    </article>
  );
}

function ContentView({ item }: { item: Exclude<FormItem, { kind: "question" }> }) {
  if (item.kind === "section") {
    return (
      <article className="content-item">
        <h3>{item.title || "제목 없는 섹션"}</h3>
        {item.description && <p>{item.description}</p>}
        <dl className="question-meta">
          <dt>분류</dt><dd>섹션</dd>
          <dt>item ID</dt><dd>{item.itemId}</dd>
          <dt>다음 이동</dt><dd>{navigationLabel(item.navigation)}</dd>
        </dl>
      </article>
    );
  }

  if (item.kind === "text_block") {
    return (
      <article className="content-item">
        <h3>{item.title || "제목 없는 설명"}</h3>
        {item.description && <p>{item.description}</p>}
        <dl className="question-meta"><dt>분류</dt><dd>제목 및 설명</dd><dt>item ID</dt><dd>{item.itemId}</dd></dl>
      </article>
    );
  }

  if (item.kind === "image") {
    return (
      <article className="content-item">
        <h3>{item.title || item.image.altText || "이미지"}</h3>
        {item.description && <p>{item.description}</p>}
        <dl className="question-meta"><dt>분류</dt><dd>이미지</dd><dt>item ID</dt><dd>{item.itemId}</dd><dt>이미지 ID</dt><dd>{item.image.sourceId}</dd></dl>
        <ImageView image={item.image} />
      </article>
    );
  }

  return (
    <article className="content-item">
      <h3>{item.title || "동영상"}</h3>
      {item.description && <p>{item.description}</p>}
      <dl className="question-meta"><dt>분류</dt><dd>동영상</dd><dt>item ID</dt><dd>{item.itemId}</dd><dt>video ID</dt><dd>{item.video.videoId}</dd></dl>
      <iframe
        className="video-frame"
        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.video.videoId)}`}
        title={item.title || "Google Forms 동영상"}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
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
  return !/이름|성명|전화|연락처|휴대폰|이메일|메일\s*주소|학번|사번|주소|우편|url|링크|나이|연령|숫자|수치|금액|생년월일|날짜|시간/i.test(
    `${question.title} ${question.description ?? ""}`,
  );
}

export function Workbench() {
  const [url, setUrl] = useState("");
  const [form, setForm] = useState<ImportedForm | null>(null);
  const [rules, setRules] = useState<GenerationRule[]>([]);
  const [responses, setResponses] = useState<GeneratedResponse[]>([]);
  const [count, setCount] = useState(10);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<"summary" | "individual">("summary");
  const [submission, setSubmission] = useState<SubmissionProgress | null>(null);
  const [manualTextQuestionIds, setManualTextQuestionIds] = useState<Set<string>>(new Set());
  const busy = analyzing || generating || submitting;

  const ruleMap = useMemo(() => new Map(rules.map((rule) => [rule.questionId, rule])), [rules]);
  const validationResults = useMemo(
    () => form ? responses.map((response) => validateGeneratedResponse(form, response)) : [],
    [form, responses],
  );
  const allResponsesValid = validationResults.every((result) => result.valid);

  async function analyzeForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim() || busy) return;
    setAnalyzing(true);
    setError(null);
    setMessage(null);
    setForm(null);
    setRules([]);
    setResponses([]);
    setSubmission(null);
    setManualTextQuestionIds(new Set());

    try {
      const result = await fetch("/api/forms/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const payload = await result.json() as { form?: ImportedForm; error?: { message?: string } };
      if (!result.ok || !payload.form) throw new Error(payload.error?.message ?? "폼을 분석하지 못했습니다.");
      setForm(payload.form);
      setRules(createDefaultRules(payload.form));
      setMessage("분석 완료");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "폼을 분석하지 못했습니다.");
    } finally {
      setAnalyzing(false);
    }
  }

  function updateRule(next: GenerationRule) {
    const previous = rules.find((rule) => rule.questionId === next.questionId);
    setRules((current) => current.map((rule) => rule.questionId === next.questionId ? next : rule));
    if (
      next.kind === "text" &&
      previous?.kind === "text" &&
      previous.samples.join("\n") !== next.samples.join("\n")
    ) {
      setManualTextQuestionIds((current) => new Set(current).add(next.questionId));
    }
    setResponses([]);
    setSubmission(null);
  }

  async function rulesWithAiAnswers(requestedCount: number): Promise<GenerationRule[]> {
    if (!form) return rules;
    const textQuestions = form.questions.filter(needsAiText);
    const aiSampleCount = Math.min(requestedCount, 100);
    let nextRules = [...rules];

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
    if (!form || busy) return;
    const requestedCount = Math.max(1, Math.min(500, Math.floor(count || 1)));
    setCount(requestedCount);
    setGenerating(true);
    setError(null);
    setMessage("응답 생성 중");
    setResponses([]);
    setSubmission(null);

    try {
      const nextRules = await rulesWithAiAnswers(requestedCount);
      const seed = `${form.source.publicId}:${Date.now()}:${crypto.randomUUID()}`;
      const generated = generateResponses({ form, rules: nextRules, count: requestedCount, seed });
      setRules(nextRules);
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
    if (!form || responses.length === 0 || busy) return;
    if (!window.confirm(`${responses.length}개 응답을 실제 Google Forms에 순차 제출합니다. 계속할까요?`)) return;

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

  const itemCount = form?.items?.length ?? form?.questions.length ?? 0;
  const optionCount = form?.questions.reduce((sum, question) => sum + question.options.length, 0) ?? 0;
  const entryCount = form?.questions.reduce((sum, question) => sum + question.entryIds.length, 0) ?? 0;
  const skippedItems = form?.diagnostics.skippedItems ?? [];

  return (
    <main className="workbench">
      <form className="import-form" onSubmit={analyzeForm}>
        <label className="sr-only" htmlFor="form-url">Google Forms 링크</label>
        <input
          id="form-url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Google Forms 링크"
          maxLength={2_048}
          disabled={busy}
          required
        />
        <button type="submit" disabled={busy}>{analyzing ? "분석 중" : "검색"}</button>
      </form>

      {error && <p className="message error" role="alert">{error}</p>}
      {message && <p className="message success" role="status">{message}</p>}

      {form && (
        <section className="analysis" aria-label="Google Forms 분석 결과">
          <div className="form-heading">
            <h1>{form.title || "제목 없는 설문지"}</h1>
            {form.description && <p>{form.description}</p>}
            <div className="form-counts">
              <span>항목 {itemCount}</span>
              <span>문항 {form.questions.length}</span>
              <span>섹션 {form.sections.length}</span>
              <span>선택지 {optionCount}</span>
              <span>entry ID {entryCount}</span>
              <span>제외 {skippedItems.length}</span>
            </div>
            <dl className="question-meta">
              <dt>폼 ID</dt><dd>{form.source.publicId}</dd>
              <dt>원본 URL</dt><dd><a href={form.source.canonicalUrl} target="_blank" rel="noreferrer">{form.source.canonicalUrl}</a></dd>
              <dt>언어</dt><dd>{form.locale}</dd>
              <dt>파서</dt><dd>{form.parserVersion} / schema {form.schemaVersion}</dd>
              {form.submission?.actionUrl && <><dt>제출 URL</dt><dd>{form.submission.actionUrl}</dd></>}
              {form.submission?.pageHistory && <><dt>pageHistory</dt><dd>{form.submission.pageHistory}</dd></>}
            </dl>
          </div>

          <div className="section-block">
            <div className="section-heading">
              <h2>분석 결과</h2>
              <p>폼에 나타난 순서대로 문항, 섹션, 설명, 이미지, 동영상을 분류했습니다.</p>
            </div>
            <fieldset className="item-list analysis-fields" disabled={busy}>
              {form.items?.map((item) => item.kind === "question" ? (
                <QuestionView
                  key={`${item.kind}:${item.id}`}
                  question={item}
                  rule={ruleMap.get(item.id)}
                  onRuleChange={updateRule}
                />
              ) : (
                <ContentView key={`${item.kind}:${item.id}`} item={item} />
              )) ?? form.questions.map((question) => (
                <QuestionView
                  key={question.id}
                  question={question}
                  rule={ruleMap.get(question.id)}
                  onRuleChange={updateRule}
                />
              ))}
            </fieldset>
          </div>

          {skippedItems.length > 0 && (
            <div className="section-block">
              <div className="section-heading"><h2>제외된 항목</h2></div>
              <div className="item-list">
                {skippedItems.map((item) => (
                  <article className="content-item" key={item.itemId}>
                    <h3>{item.title || "파일 업로드"}</h3>
                    <dl className="question-meta">
                      <dt>분류</dt><dd>파일 업로드 (지원 제외)</dd>
                      <dt>item ID</dt><dd>{item.itemId}</dd>
                      <dt>원본 유형</dt><dd>{item.rawType}</dd>
                    </dl>
                  </article>
                ))}
              </div>
            </div>
          )}

          {form.diagnostics.warnings.length > 0 && (
            <div className="section-block">
              <div className="section-heading"><h2>분석 경고</h2></div>
              {form.diagnostics.warnings.map((warning) => <p className="message" key={warning}>{warning}</p>)}
            </div>
          )}

          <section className="generation-panel">
            <div className="panel-heading">
              <div><h2>가상 응답 생성</h2><p>주관식 문구는 충남대 API Gateway로 문항을 분석해 생성합니다.</p></div>
            </div>
            <div className="generation-controls">
              <label className="field">
                생성 개수
                <input type="number" min={1} max={500} value={count} disabled={busy} onChange={(event) => setCount(Number(event.target.value))} />
              </label>
              <button className="primary-button" type="button" disabled={busy} onClick={() => void generate()}>
                {generating ? "생성 중" : "생성"}
              </button>
            </div>
          </section>

          {responses.length > 0 && (
            <section className="preview-panel">
              <div className="panel-heading">
                <div><h2>미리보기</h2><p>{responses.length}개 응답</p></div>
              </div>
              <div className="preview-tabs" role="tablist" aria-label="미리보기 방식">
                <button type="button" role="tab" aria-selected={previewTab === "summary"} onClick={() => setPreviewTab("summary")}>요약</button>
                <button type="button" role="tab" aria-selected={previewTab === "individual"} onClick={() => setPreviewTab("individual")}>개별</button>
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
            <section className="submission-panel">
              <div className="panel-heading">
                <div><h2>실제 제출</h2><p>생성된 응답을 한 개씩 순서대로 Google Forms에 제출합니다.</p></div>
              </div>
              {!allResponsesValid && <p className="message error">유효하지 않은 응답이 있어 제출할 수 없습니다.</p>}
              <button
                className="submit-button"
                type="button"
                disabled={busy || !allResponsesValid}
                onClick={() => void submitSequentially()}
              >
                {submitting ? "제출 중" : `${responses.length}개 순차 제출`}
              </button>
              {submission && (
                <>
                  <div className="submission-progress" aria-label={`${submission.done}/${responses.length} 제출 처리`}>
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
        </section>
      )}
    </main>
  );
}
