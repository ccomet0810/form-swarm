export function ReadonlyAnswerField({
  kind,
  value,
  emptyLabel = "응답 없음",
}: {
  kind: "short_text" | "paragraph";
  value?: string | null;
  emptyLabel?: string;
}) {
  const empty = !value?.trim();
  return (
    <div
      className={`readonly-text-answer readonly-text-answer--${kind}`}
      data-empty={empty ? "" : undefined}
    >
      {empty ? emptyLabel : value}
    </div>
  );
}
