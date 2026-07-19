import type { CSSProperties } from "react";
import type {
  FormQuestion,
  GeneratedResponse,
} from "../../lib/domain/form-schema";
import {
  summarizeQuestion,
  type QuestionSummary,
  type SummaryValue,
} from "../../lib/summary/aggregate";

const CHART_COLORS = [
  "#0a0a0a",
  "#333333",
  "#555555",
  "#777777",
  "#999999",
  "#b3b3b3",
  "#cccccc",
  "#e0e0e0",
];

type ChartStyle = CSSProperties & Record<`--${string}`, string | number>;

function valueStyle(value: number, max: number): ChartStyle {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return {
    "--chart-value": `${ratio * 100}%`,
    "--chart-ratio": ratio,
  };
}

function niceCountAxis(maxValue: number): { max: number; ticks: number[] } {
  const maximum = Math.max(0, Math.ceil(maxValue));
  if (maximum <= 5) {
    const max = Math.max(1, maximum);
    return { max, ticks: Array.from({ length: max + 1 }, (_, index) => index) };
  }

  const roughStep = maximum / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const max = Math.ceil(maximum / step) * step;
  return {
    max,
    ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step),
  };
}

function pieGradientStops(values: SummaryValue[], total: number): string[] {
  if (total <= 0) return [];
  let precedingCount = 0;
  return values.flatMap((value, colorIndex) => {
    if (value.count <= 0) return [];
    const start = (precedingCount / total) * 100;
    precedingCount += value.count;
    const end = (precedingCount / total) * 100;
    return [`${CHART_COLORS[colorIndex % CHART_COLORS.length]} ${start}% ${end}%`];
  });
}

function PieChart({ values }: { values: SummaryValue[] }) {
  const total = values.reduce((sum, value) => sum + value.count, 0);
  const stops = pieGradientStops(values, total);
  const background = stops.length > 0
    ? `conic-gradient(${stops.join(", ")})`
    : "#e8eaed";

  return (
    <div className="pie-layout">
      <div className="pie-chart" style={{ background }} aria-hidden="true" />
      <div className="chart-legend" aria-label="선택지별 응답 분포">
        {values.map((value, index) => (
          <div key={`${value.label}-${index}`}>
            <span style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
            <b>{value.label}</b>
            <small>{value.count}개 ({value.percentage}%)</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function HorizontalBars({ values }: { values: SummaryValue[] }) {
  return (
    <div className="horizontal-chart" aria-label="선택지별 복수 응답 분포">
      {values.map((value, index) => (
        <div className="horizontal-row" key={`${value.label}-${index}`}>
          <span title={value.label}>{value.label}</span>
          <div className="horizontal-bar-track">
            <i
              title={`${value.count}개, ${value.percentage}%`}
              style={valueStyle(value.percentage, 100)}
            />
          </div>
          <b>{value.count} ({value.percentage}%)</b>
        </div>
      ))}
    </div>
  );
}

function ChartAxis({ ticks }: { ticks: number[] }) {
  return (
    <div className="chart-y-axis" aria-hidden="true">
      {[...ticks].reverse().map((tick) => <span key={tick}>{tick}</span>)}
    </div>
  );
}

function VerticalBars({ values }: { values: SummaryValue[] }) {
  const axis = niceCountAxis(Math.max(0, ...values.map((value) => value.count)));
  const chartStyle: ChartStyle = {
    "--chart-category-count": Math.max(1, values.length),
    "--chart-tick-count": Math.max(1, axis.ticks.length - 1),
  };

  return (
    <div className="vertical-chart-frame">
      <ChartAxis ticks={axis.ticks} />
      <div className="vertical-chart-scroll" role="region" tabIndex={0} aria-label="응답 분포 차트">
        <div className="vertical-chart" style={chartStyle}>
          {values.map((value, index) => (
            <div className="vertical-column" key={`${value.label}-${index}`}>
              <b>
                {value.count}
                {value.count > 0 && <small> ({value.percentage}%)</small>}
              </b>
              <div>
                <i
                  title={`${value.label}: ${value.count}개, ${value.percentage}%`}
                  style={valueStyle(value.count, axis.max)}
                />
              </div>
              <span title={value.label}>{value.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GridChart({
  rows,
}: {
  rows: Array<{ label: string; answeredCount: number; values: SummaryValue[] }>;
}) {
  const columns = rows[0]?.values.map((value) => value.label) ?? [];
  const axis = niceCountAxis(
    Math.max(0, ...rows.flatMap((row) => row.values.map((value) => value.count))),
  );
  const chartStyle: ChartStyle = {
    "--chart-category-count": Math.max(1, rows.length),
    "--chart-series-count": Math.max(1, columns.length),
    "--chart-tick-count": Math.max(1, axis.ticks.length - 1),
  };

  return (
    <div className="grid-summary">
      <div className="grid-chart-frame">
        <ChartAxis ticks={axis.ticks} />
        <div className="grid-chart-scroll" role="region" tabIndex={0} aria-label="행과 열별 응답 분포 차트">
          <div className="grid-chart" style={chartStyle}>
            <div className="grid-plot">
              {rows.map((row, rowIndex) => (
                <div className="grid-column" key={`${row.label}-${rowIndex}`}>
                  <div className="grid-bars">
                    {row.values.map((value, columnIndex) => (
                      <i
                        key={`${value.label}-${columnIndex}`}
                        title={`${row.label} · ${value.label}: ${value.count}개, ${value.percentage}%`}
                        style={{
                          ...valueStyle(value.count, axis.max),
                          background: CHART_COLORS[columnIndex % CHART_COLORS.length],
                        }}
                      />
                    ))}
                  </div>
                  <span title={row.label}>{row.label}</span>
                </div>
              ))}
            </div>
            <div className="grid-legend" aria-label="열 범례">
              {columns.map((column, columnIndex) => (
                <span key={`${column}-${columnIndex}`}>
                  <i style={{ background: CHART_COLORS[columnIndex % CHART_COLORS.length] }} />
                  {column}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid-table-scroll" role="region" tabIndex={0} aria-label="행과 열별 응답 분포 표">
        <table
          className="grid-data-table"
          aria-label="행과 열별 응답 분포"
          style={{
            "--grid-table-min-width": `${Math.max(280, (columns.length + 1) * 70)}px`,
          } as ChartStyle}
        >
          <thead>
            <tr>
              <th scope="col" />
              {columns.map((column, index) => <th scope="col" key={`${column}-${index}`}>{column}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${row.label}-${rowIndex}`}>
                <th scope="row">{row.label}</th>
                {row.values.map((value, columnIndex) => (
                  <td key={`${value.label}-${columnIndex}`}>
                    <span>{value.count}</span>
                    <small>{value.percentage}%</small>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TextResponseList({ values }: { values: string[] }) {
  return (
    <div className="text-response-list" role="list" aria-label="주관식 응답">
      {values.map((value, index) => (
        <p role="listitem" key={index}>{value}</p>
      ))}
    </div>
  );
}

function TemporalList({ values }: { values: SummaryValue[] }) {
  return (
    <div className="temporal-list" aria-label="날짜 또는 시간별 응답 분포">
      {values.map((value, index) => (
        <div key={`${value.label}-${index}`}>
          <span>{value.label}</span>
          <b title={`${value.percentage}%`}>{value.count}</b>
        </div>
      ))}
    </div>
  );
}

export interface ResponseSummaryCardProps {
  question: FormQuestion;
  responses?: GeneratedResponse[];
  summary?: QuestionSummary;
}

export function ResponseSummaryCard({
  question,
  responses = [],
  summary: providedSummary,
}: ResponseSummaryCardProps) {
  const summary = providedSummary ?? summarizeQuestion(question, responses);

  return (
    <article className="summary-card">
      <header>
        <h3>{question.title || "제목 없는 문항"}</h3>
        <span>응답 {summary.responseCount}개</span>
      </header>

      {summary.responseCount === 0 ? (
        <p className="empty-summary">응답이 없습니다.</p>
      ) : (
        <div className="summary-card-body">
          {summary.kind === "pie" && <PieChart values={summary.values} />}
          {summary.kind === "horizontal_bars" && <HorizontalBars values={summary.values} />}
          {summary.kind === "vertical_bars" && (
            <>
              {typeof summary.average === "number" && (
                <p className="average-rating">평균 {summary.average.toFixed(2)}</p>
              )}
              <VerticalBars values={summary.values} />
            </>
          )}
          {summary.kind === "grid" && <GridChart rows={summary.rows} />}
          {summary.kind === "text_list" && <TextResponseList values={summary.values} />}
          {summary.kind === "temporal" && <TemporalList values={summary.values} />}
          {summary.kind === "unsupported" && (
            <p className="empty-summary">표시할 수 있는 응답이 없습니다.</p>
          )}
        </div>
      )}
    </article>
  );
}
