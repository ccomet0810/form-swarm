import type { CSSProperties } from "react";
import type {
  FormQuestion,
  GeneratedResponse,
} from "../../lib/domain/form-schema";
import {
  summarizeQuestion,
  type SummaryValue,
} from "../../lib/summary/aggregate";

const CHART_COLORS = [
  "#3367d6",
  "#d93025",
  "#f9ab00",
  "#188038",
  "#9334e6",
  "#12b5cb",
  "#e8710a",
  "#5f6368",
];

function valueStyle(value: number, max: number): CSSProperties {
  return { "--chart-value": `${max > 0 ? (value / max) * 100 : 0}%` } as CSSProperties;
}

function PieChart({ values }: { values: SummaryValue[] }) {
  const total = values.reduce((sum, value) => sum + value.count, 0);
  const visibleValues = values
    .map((value, colorIndex) => ({ value, colorIndex }))
    .filter(({ value }) => value.count > 0);
  const stops = visibleValues
    .map(({ value, colorIndex }, index) => {
      const precedingCount = visibleValues
        .slice(0, index)
        .reduce((sum, preceding) => sum + preceding.value.count, 0);
      const start = total > 0 ? (precedingCount / total) * 100 : 0;
      const end = total > 0 ? ((precedingCount + value.count) / total) * 100 : 0;
      return `${CHART_COLORS[colorIndex % CHART_COLORS.length]} ${start}% ${end}%`;
    });
  const background = stops.length > 0
    ? `conic-gradient(${stops.join(", ")})`
    : "#e8eaed";

  return (
    <div className="pie-layout">
      <div className="pie-chart" style={{ background }} aria-label="응답 비율 원그래프" />
      <div className="chart-legend">
        {values.map((value, index) => (
          <div key={value.label}>
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
    <div className="horizontal-chart">
      {values.map((value) => (
        <div className="horizontal-row" key={value.label}>
          <span title={value.label}>{value.label}</span>
          <div><i style={valueStyle(value.percentage, 100)} /></div>
          <b>{value.count} ({value.percentage}%)</b>
        </div>
      ))}
    </div>
  );
}

function VerticalBars({ values }: { values: SummaryValue[] }) {
  const max = Math.max(1, ...values.map((value) => value.count));
  return (
    <div className="vertical-chart-scroll">
      <div className="vertical-chart">
        {values.map((value) => (
          <div className="vertical-column" key={value.label}>
            <b>{value.count > 0 ? `${value.count} (${value.percentage}%)` : "0"}</b>
            <div><i style={valueStyle(value.count, max)} /></div>
            <span title={value.label}>{value.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GridChart({
  rows,
}: {
  rows: Array<{ label: string; values: SummaryValue[] }>;
}) {
  const columns = rows[0]?.values.map((value) => value.label) ?? [];
  const max = Math.max(
    1,
    ...rows.flatMap((row) => row.values.map((value) => value.count)),
  );

  return (
    <div className="grid-chart-scroll">
      <div className="grid-chart" style={{ minWidth: `${Math.max(440, rows.length * 130)}px` }}>
        <div className="grid-plot">
          {rows.map((row) => (
            <div className="grid-column" key={row.label}>
              <div className="grid-bars">
                {row.values.map((value, columnIndex) => (
                  <i
                    key={value.label}
                    title={`${row.label} · ${value.label}: ${value.count}`}
                    style={{
                      ...valueStyle(value.count, max),
                      background: CHART_COLORS[columnIndex % CHART_COLORS.length],
                    }}
                  />
                ))}
              </div>
              <span>{row.label}</span>
            </div>
          ))}
        </div>
        <div className="grid-legend">
          {columns.map((column, columnIndex) => (
            <span key={column}>
              <i style={{ background: CHART_COLORS[columnIndex % CHART_COLORS.length] }} />
              {column}
            </span>
          ))}
        </div>
        <table>
          <thead>
            <tr><th />{columns.map((column) => <th key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th>{row.label}</th>
                {row.values.map((value) => <td key={value.label}>{value.count}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ResponseSummaryCard({
  question,
  responses,
}: {
  question: FormQuestion;
  responses: GeneratedResponse[];
}) {
  const summary = summarizeQuestion(question, responses);

  return (
    <article className="summary-card">
      <header>
        <h3>{question.title}</h3>
        <span>응답 {summary.responseCount}개</span>
      </header>

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
      {summary.kind === "text_list" && (
        <div className="text-response-list">
          {summary.values.map((value, index) => <p key={`${value}-${index}`}>{value}</p>)}
        </div>
      )}
      {summary.kind === "temporal" && (
        <div className="temporal-list">
          {summary.values.map((value) => (
            <div key={value.label}>
              <span>{value.label}</span>
              {value.count > 1 && <b>{value.count}</b>}
            </div>
          ))}
        </div>
      )}
      {summary.kind === "unsupported" && (
        <p className="empty-summary">표시할 수 있는 응답이 없습니다.</p>
      )}
    </article>
  );
}
