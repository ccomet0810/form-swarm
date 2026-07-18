"use client";

import {
  AlertTriangle,
  ArrowRight,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Download,
  FlaskConical,
  Info,
  Layers3,
  Link2,
  LoaderCircle,
  LockKeyhole,
  PanelTop,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Table2,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  FormQuestion,
  GeneratedAnswer,
  GeneratedResponse,
  GenerationRule,
  ImportedForm,
  QuestionType,
} from "../../lib/domain/form-schema";
import {
  generateResponses,
  RESPONSE_GENERATOR_VERSION,
} from "../../lib/generator/engine";
import { createDefaultRules } from "../../lib/generator/rules";
import { validateGeneratedResponse } from "../../lib/generator/validation";
import { QuestionIcon } from "./icons";

const SAMPLE_FORMS = [
  {
    label: "온보딩 경험 평가",
    detail: "그리드 · 척도 · 별점",
    url: "https://docs.google.com/forms/d/e/1FAIpQLSeoFC1jW6yqDNDx-RbAam_GfT7kBgrKwVDMFa9-wUEfFlDTdA/viewform",
  },
  {
    label: "손글씨 폰트 설문",
    detail: "체크박스 · 기타 · 필수",
    url: "https://docs.google.com/forms/d/e/1FAIpQLSf4Wnw-bPB2CLK1Aj-YBXS1kZoZFiUEzWNjRmKNZjali6c85g/viewform",
  },
] as const;

const TYPE_LABEL: Record<QuestionType, string> = {
  short_text: "단답형",
  paragraph: "장문형",
  single_choice: "객관식",
  dropdown: "드롭다운",
  checkboxes: "체크박스",
  scale: "선형 척도",
  grid_single: "객관식 그리드",
  rating: "별점",
  date: "날짜",
  time: "시간",
  unknown: "미지원",
};

const RULE_LABEL: Record<GenerationRule["kind"], string> = {
  text: "샘플 풀",
  choice: "선택 분포",
  checkboxes: "선택 개수",
  grid: "행별 선택",
  unsupported: "생성 제외",
};

type Phase = "source" | "rules" | "preview";

function answerLabel(answer: GeneratedAnswer | undefined): string {
  if (answer === undefined) return "—";
  if (typeof answer === "string") return answer;
  if (Array.isArray(answer)) return answer.length > 0 ? answer.join(", ") : "선택 안 함";
  return Object.entries(answer)
    .map(([row, value]) => `${row}: ${value}`)
    .join(" · ");
}

function compactId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;
}

function Step({
  index,
  label,
  active,
  complete,
}: {
  index: number;
  label: string;
  active: boolean;
  complete: boolean;
}) {
  return (
    <div className={`flow-step ${active ? "is-active" : ""} ${complete ? "is-complete" : ""}`}>
      <span className="flow-index">{complete ? <Check size={13} /> : index}</span>
      <span>{label}</span>
    </div>
  );
}

function StatusPill({ phase }: { phase: Phase }) {
  const labels: Record<Phase, string> = {
    source: "링크 대기",
    rules: "구조 분석 완료",
    preview: "미리보기 준비됨",
  };
  return (
    <span className={`status-pill status-${phase}`}>
      <span className="status-dot" />
      {labels[phase]}
    </span>
  );
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function RuleEditor({
  question,
  rule,
  onChange,
}: {
  question: FormQuestion;
  rule: GenerationRule;
  onChange: (rule: GenerationRule) => void;
}) {
  const enabled = rule.enabled;
  const selectableOptionCount = question.options.filter(
    (option) => !option.isOther,
  ).length;

  return (
    <article className={`question-card ${enabled ? "" : "is-disabled"}`}>
      <div className="question-head">
        <div className="question-type-icon">
          <QuestionIcon type={question.type} />
        </div>
        <div className="question-copy">
          <div className="question-eyebrow">
            <span>{TYPE_LABEL[question.type]}</span>
            <span>{question.required ? "필수" : "선택"}</span>
            <code title={question.entryIds.join(", ")}>
              entry.{compactId(question.entryIds[0] ?? "없음")}
              {question.entryIds.length > 1 ? ` +${question.entryIds.length - 1}` : ""}
            </code>
          </div>
          <h3>{question.title}</h3>
          {question.description && <p>{question.description}</p>}
        </div>
        <label className="switch-label">
          <input
            aria-label={`${question.title} 생성 포함`}
            type="checkbox"
            checked={enabled}
            disabled={rule.kind === "unsupported" || question.required}
            title={question.required ? "필수 문항은 생성에서 제외할 수 없습니다." : undefined}
            onChange={(event) => onChange({ ...rule, enabled: event.target.checked } as GenerationRule)}
          />
          <span className="switch" aria-hidden="true" />
        </label>
      </div>

      <div className="rule-row">
        <span className="rule-kicker"><Settings2 size={14} /> {RULE_LABEL[rule.kind]}</span>
        {rule.kind === "choice" && (
          <label className="select-wrap">
            <span className="sr-only">생성 분포</span>
            <select
              value={rule.mode}
              disabled={!enabled}
              onChange={(event) =>
                onChange({ ...rule, mode: event.target.value } as GenerationRule)
              }
            >
              <option value="uniform">균등 랜덤</option>
              <option value="middle_weighted">중앙값 중심</option>
              <option value="fixed">고정값</option>
            </select>
            <ChevronDown size={14} />
          </label>
        )}
        {rule.kind === "choice" && rule.mode === "fixed" && (
          <label className="select-wrap fixed-choice">
            <span className="sr-only">고정 선택지</span>
            <select
              value={rule.fixedValue ?? question.options.find((option) => !option.isOther)?.value ?? ""}
              disabled={!enabled}
              onChange={(event) => onChange({ ...rule, fixedValue: event.target.value })}
            >
              {question.options.filter((option) => !option.isOther).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
        )}
        {rule.kind === "checkboxes" && (
          <div className="range-editor">
            <label>
              최소
              <input
                type="number"
                min={question.required ? 1 : 0}
                max={selectableOptionCount}
                value={rule.minSelections}
                disabled={!enabled}
                onChange={(event) =>
                  onChange({ ...rule, minSelections: Number(event.target.value) })
                }
              />
            </label>
            <span>~</span>
            <label>
              최대
              <input
                type="number"
                min={1}
                max={selectableOptionCount}
                value={rule.maxSelections}
                disabled={!enabled}
                onChange={(event) =>
                  onChange({ ...rule, maxSelections: Number(event.target.value) })
                }
              />
            </label>
            <span className="muted">개 선택</span>
          </div>
        )}
        {rule.kind === "text" && (
          <div className="text-rule">
            <label className="select-wrap">
              <span className="sr-only">텍스트 생성 규칙</span>
              <select
                value={rule.mode}
                disabled={!enabled}
                onChange={(event) =>
                  onChange({ ...rule, mode: event.target.value } as GenerationRule)
                }
              >
                <option value="sample_pool">무작위 샘플</option>
                <option value="sequence">순서대로 반복</option>
              </select>
              <ChevronDown size={14} />
            </label>
            <input
              aria-label="샘플 응답"
              className="sample-input"
              maxLength={2_000}
              value={rule.samples.join(" | ")}
              disabled={!enabled}
              onChange={(event) =>
                onChange({
                  ...rule,
                  samples: event.target.value.split("|").map((value) => value.trim()).filter(Boolean),
                })
              }
            />
          </div>
        )}
        {rule.kind === "grid" && (
          <label className="select-wrap">
            <span className="sr-only">그리드 생성 규칙</span>
            <select
              value={rule.mode}
              disabled={!enabled}
              onChange={(event) => onChange({ ...rule, mode: event.target.value } as GenerationRule)}
            >
              <option value="uniform">행별 균등 랜덤</option>
              <option value="middle_weighted">중앙 열 중심</option>
            </select>
            <ChevronDown size={14} />
          </label>
        )}
        {rule.kind === "unsupported" && (
          <span className="unsupported-note"><AlertTriangle size={14} /> 안전을 위해 제외됨</span>
        )}
        <span className="option-summary">
          {question.grid
            ? `${question.grid.rows.length}행 × ${question.grid.columns.length}열`
            : question.options.length > 0
              ? `${question.options.length}개 선택지`
              : `${rule.kind === "text" ? rule.samples.length : 0}개 샘플`}
        </span>
      </div>
    </article>
  );
}

export function Workbench() {
  const [url, setUrl] = useState<string>(SAMPLE_FORMS[0].url);
  const [form, setForm] = useState<ImportedForm | null>(null);
  const [rules, setRules] = useState<GenerationRule[]>([]);
  const [responses, setResponses] = useState<GeneratedResponse[]>([]);
  const [count, setCount] = useState(12);
  const [seed, setSeed] = useState("formswarm-2026");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [activePreview, setActivePreview] = useState(0);

  const phase: Phase = responses.length > 0 ? "preview" : form ? "rules" : "source";
  const enabledRuleCount = rules.filter((rule) => rule.enabled).length;
  const requiredCount = form?.questions.filter((question) => question.required).length ?? 0;
  const optionCount = form?.questions.reduce((sum, question) => sum + question.options.length, 0) ?? 0;

  const ruleMap = useMemo(
    () => new Map(rules.map((rule) => [rule.questionId, rule])),
    [rules],
  );
  const validationByResponse = useMemo(
    () =>
      new Map(
        responses.map((response) => [
          response.id,
          form
            ? validateGeneratedResponse(form, response)
            : { valid: false, issues: [] },
        ]),
      ),
    [form, responses],
  );

  async function importForm() {
    setLoading(true);
    setError(null);
    setResponses([]);
    try {
      const response = await fetch("/api/forms/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = await response.json() as {
        form?: ImportedForm;
        error?: { message: string };
      };
      if (!response.ok || !payload.form) {
        throw new Error(payload.error?.message ?? "폼을 가져오지 못했습니다.");
      }
      setForm(payload.form);
      setRules(createDefaultRules(payload.form));
      setExpandedSections(new Set(payload.form.sections.map((section) => section.id)));
    } catch (caught) {
      setForm(null);
      setRules([]);
      setError(caught instanceof Error ? caught.message : "폼을 가져오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function updateRule(nextRule: GenerationRule) {
    setRules((current) =>
      current.map((rule) => (rule.questionId === nextRule.questionId ? nextRule : rule)),
    );
    setResponses([]);
  }

  function generate() {
    if (!form) return;
    const generated = generateResponses({ form, rules, count, seed: seed.slice(0, 128) });
    setResponses(generated);
    setActivePreview(0);
    requestAnimationFrame(() => {
      document.getElementById("preview")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function downloadPreview() {
    if (!form || responses.length === 0) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportSchemaVersion: "1.0",
            exportedAt: new Date().toISOString(),
            generatorVersion: RESPONSE_GENERATOR_VERSION,
            form,
            rules,
            seed,
            responses,
            validation: responses.map((response) => ({
              responseId: response.id,
              ...validationByResponse.get(response.id),
            })),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `form-swarm-preview-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  function toggleSection(sectionId: string) {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Form Swarm 홈">
          <span className="brand-mark"><Braces size={18} /></span>
          <span>Form<span>Swarm</span></span>
        </a>
        <nav className="flow" aria-label="작업 단계">
          <Step index={1} label="링크" active={phase === "source"} complete={Boolean(form)} />
          <ChevronRight className="flow-arrow" size={15} />
          <Step index={2} label="규칙·생성" active={phase === "rules"} complete={responses.length > 0} />
          <ChevronRight className="flow-arrow" size={15} />
          <Step index={3} label="미리보기" active={phase === "preview"} complete={false} />
        </nav>
        <div className="top-actions">
          <StatusPill phase={phase} />
          <span className="lab-badge"><FlaskConical size={13} /> READ-ONLY LAB</span>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow"><Sparkles size={14} /> 공개 폼 구조 분석기</span>
            <h1>링크 하나로,<br /><em>응답 설계</em>까지.</h1>
            <p>
              Google Forms 원본을 읽어 문항과 입력 ID를 분류하고,
              유형별 생성 규칙을 바로 구성합니다.
            </p>
          </div>
          <div className="source-panel">
            <div className="panel-label"><Link2 size={15} /> GOOGLE FORMS URL</div>
            <div className={`url-box ${error ? "has-error" : ""}`}>
              <Link2 size={18} />
              <input
                aria-label="Google Forms 링크"
                value={url}
                maxLength={2_048}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void importForm(); }}
                placeholder="https://docs.google.com/forms/d/e/.../viewform"
              />
              <button onClick={() => void importForm()} disabled={loading || !url.trim()}>
                {loading ? <LoaderCircle className="spin" size={17} /> : <PanelTop size={17} />}
                {loading ? "분석 중" : "폼 분석"}
                {!loading && <ArrowRight size={16} />}
              </button>
            </div>
            {error && <p className="error-message"><AlertTriangle size={14} /> {error}</p>}
            <div className="sample-row">
              <span>테스트 폼</span>
              {SAMPLE_FORMS.map((sample, index) => (
                <button
                  key={sample.url}
                  className={url === sample.url ? "is-selected" : ""}
                  onClick={() => { setUrl(sample.url); setError(null); }}
                >
                  <span>{index + 1}</span>
                  <strong>{sample.label}</strong>
                  <small>{sample.detail}</small>
                </button>
              ))}
            </div>
            <div className="trust-line">
              <span><ShieldCheck size={14} /> 허용된 Google 도메인만 접근</span>
              <span><LockKeyhole size={14} /> 이 단계에서는 응답을 전송하지 않음</span>
            </div>
          </div>
        </section>

        {!form && (
          <section className="empty-stage" aria-label="분석 대기">
            <div className="architecture-strip">
              <span><Link2 /> 링크 검증</span><ArrowRight />
              <span><Braces /> 내부 데이터 추출</span><ArrowRight />
              <span><Layers3 /> 문항 정규화</span><ArrowRight />
              <span><Settings2 /> 규칙 자동 구성</span><ArrowRight />
              <span><Table2 /> 안전한 미리보기</span>
            </div>
          </section>
        )}

        {form && (
          <>
            <section className="form-summary">
              <div className="summary-title">
                <span className="google-form-icon"><span /><span /><span /></span>
                <div>
                  <div className="summary-kicker"><CheckCircle2 size={14} /> 구조 분석 완료</div>
                  <h2>{form.title}</h2>
                  <p>{form.description ?? "설명 없음"}</p>
                </div>
                <a href={form.source.canonicalUrl} target="_blank" rel="noreferrer">
                  원본 열기 <ArrowRight size={14} />
                </a>
              </div>
              <div className="metrics">
                <Metric label="페이지" value={form.sections.length} detail="page break 기준" />
                <Metric label="문항" value={form.questions.length} detail={`${requiredCount}개 필수`} />
                <Metric label="입력 ID" value={form.questions.reduce((sum, q) => sum + q.entryIds.length, 0)} detail="entry binding" />
                <Metric label="선택지" value={optionCount} detail="기타 포함" />
              </div>
            </section>

            <section className="workspace-grid">
              <div className="rules-panel">
                <div className="section-heading">
                  <div>
                    <span className="heading-index">02</span>
                    <div><h2>생성 규칙</h2><p>문항 유형을 기준으로 기본값을 구성했습니다.</p></div>
                  </div>
                  <span className="rule-count">{enabledRuleCount}/{form.questions.length} 활성</span>
                </div>

                <div className="diagnostic-banner">
                  <Info size={16} />
                  <div>
                    <strong>구조 기반 기본 규칙입니다.</strong>
                    <span>후속 문항·상호배타 선택·개인정보 관계는 사용자가 확인해야 합니다.</span>
                    {form.diagnostics.warnings.map((warning) => (
                      <span key={warning}>• {warning}</span>
                    ))}
                  </div>
                </div>

                <div className="sections-list">
                  {form.sections.map((section) => {
                    const expanded = expandedSections.has(section.id);
                    const sectionQuestions = form.questions.filter((question) => question.sectionId === section.id);
                    return (
                      <div className="section-group" key={section.id}>
                        <button className="section-toggle" onClick={() => toggleSection(section.id)}>
                          <span className="section-number">{String(section.index + 1).padStart(2, "0")}</span>
                          <span><strong>{section.title}</strong><small>{sectionQuestions.length}개 문항</small></span>
                          {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
                        </button>
                        {expanded && sectionQuestions.length > 0 && (
                          <div className="question-list">
                            {sectionQuestions.map((question) => {
                              const rule = ruleMap.get(question.id);
                              return rule ? (
                                <RuleEditor key={question.id} question={question} rule={rule} onChange={updateRule} />
                              ) : null;
                            })}
                          </div>
                        )}
                        {expanded && sectionQuestions.length === 0 && (
                          <div className="cover-page-note"><PanelTop size={16} /> 문항 없는 표지 페이지</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <aside className="generation-panel">
                <div className="sticky-card">
                  <div className="section-heading compact">
                    <div><span className="heading-index">03</span><div><h2>가상 응답 생성</h2><p>동일한 시드는 동일한 결과를 만듭니다.</p></div></div>
                  </div>
                  <label className="field-label">
                    <span>생성 개수</span>
                    <div className="number-field">
                      <input type="number" min={1} max={500} value={count} onChange={(event) => setCount(Number(event.target.value))} />
                      <span>개</span>
                    </div>
                  </label>
                  <label className="field-label">
                    <span>랜덤 시드</span>
                    <div className="seed-field">
                      <input maxLength={128} value={seed} onChange={(event) => setSeed(event.target.value)} />
                      <button aria-label="새 시드" onClick={() => setSeed(`formswarm-${Date.now().toString(36)}`)}><RefreshCw size={15} /></button>
                    </div>
                  </label>

                  <div className="generation-recap">
                    <span><CheckCircle2 size={14} /> 활성 규칙 <strong>{enabledRuleCount}</strong></span>
                    <span><CircleDashed size={14} /> 제외 문항 <strong>{form.questions.length - enabledRuleCount}</strong></span>
                  </div>

                  <button className="generate-button" onClick={generate}>
                    <Play size={17} fill="currentColor" />
                    {count}개 미리보기 생성
                  </button>
                  <p className="dry-run-note"><ShieldCheck size={14} /> Dry run · Google에 전송되지 않습니다.</p>

                  <div className="submission-boundary">
                    <div><LockKeyhole size={16} /><span><strong>실제 제출 잠금</strong><small>소유권 확인 + 전용 테스트 폼 필요</small></span></div>
                    <button disabled>제출 큐 연결</button>
                  </div>
                </div>
              </aside>
            </section>

            {responses.length > 0 && (
              <section className="preview-section" id="preview">
                <div className="section-heading preview-heading">
                  <div><span className="heading-index">04</span><div><h2>응답 미리보기</h2><p>{responses.length}개 결과 중 선택한 1개를 상세 검토합니다.</p></div></div>
                  <button className="export-button" onClick={downloadPreview}><Download size={15} /> JSON 내보내기</button>
                </div>
                <div className="preview-layout">
                  <div className="response-rail" aria-label="생성 응답 목록">
                    {responses.map((response) => (
                      <button
                        key={response.id}
                        className={activePreview === response.index ? "is-active" : ""}
                        onClick={() => setActivePreview(response.index)}
                      >
                        <span>#{String(response.index + 1).padStart(2, "0")}</span>
                        <code>{response.id}</code>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  </div>
                  <div className="answer-table">
                    <div className="answer-table-head">
                      <div><Table2 size={16} /><strong>응답 #{String(activePreview + 1).padStart(2, "0")}</strong></div>
                      {(() => {
                        const validation = validationByResponse.get(
                          responses[activePreview]?.id ?? "",
                        );
                        return validation?.valid ? (
                          <span><span className="status-dot" /> 구조 검증 통과</span>
                        ) : (
                          <span className="is-review"><AlertTriangle size={12} /> 검토 필요 · {validation?.issues.length ?? 0}</span>
                        );
                      })()}
                    </div>
                    {form.questions.map((question) => (
                      <div className="answer-row" key={question.id}>
                        <div className="answer-question"><QuestionIcon type={question.type} /><span><small>{TYPE_LABEL[question.type]}</small><strong>{question.title}</strong></span></div>
                        <div className="answer-value">{answerLabel(responses[activePreview]?.answers[question.id])}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </main>
      <footer>
        <div><Braces size={15} /> FormSwarm <span>Schema-first response lab</span></div>
        <span>parser {form?.parserVersion ?? "대기 중"}</span>
      </footer>
    </div>
  );
}
