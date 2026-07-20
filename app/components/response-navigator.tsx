"use client";

import { useState } from "react";
import { ControlInput, IconButton } from "./form-controls";

export function resolveNavigatorIndex(
  draft: string,
  total: number,
  fallbackIndex: number,
): number {
  const lastIndex = Math.max(0, total - 1);
  const fallback = Math.max(0, Math.min(lastIndex, fallbackIndex));
  if (draft.trim() === "") return fallback;
  const parsed = Number(draft);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(0, Math.min(lastIndex, parsed - 1));
}

export function ResponseNavigator({
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
  const lastIndex = Math.max(0, total - 1);
  const clampedIndex = Math.max(0, Math.min(lastIndex, index));
  const [draftState, setDraftState] = useState({
    index: clampedIndex,
    value: String(clampedIndex + 1),
  });
  const draft = draftState.index === clampedIndex
    ? draftState.value
    : String(clampedIndex + 1);

  function updateDraft(value: string) {
    setDraftState({ index: clampedIndex, value });
  }

  function commitDraft() {
    const nextIndex = resolveNavigatorIndex(draft, total, clampedIndex);
    setDraftState({ index: nextIndex, value: String(nextIndex + 1) });
    if (nextIndex !== clampedIndex) onChange(nextIndex);
  }

  return (
    <div className="response-navigator" role="group" aria-label={`${label} 이동`}>
      <IconButton
        className="response-navigator-button"
        variant="plain"
        label={`이전 ${label}`}
        symbol="chevron_left"
        symbolSize={21}
        disabled={clampedIndex <= 0}
        onClick={() => onChange(clampedIndex - 1)}
      />
      <label className="response-index-field">
        <span className="sr-only">{label} 번호</span>
        <ControlInput
          variant="editor"
          className="response-index-input"
          type="number"
          min={1}
          max={total}
          step={1}
          inputMode="numeric"
          value={draft}
          onChange={(event) => updateDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              updateDraft(String(clampedIndex + 1));
              event.currentTarget.blur();
            }
          }}
        />
      </label>
      <span className="response-total" aria-hidden="true">
        <span>/</span>
        <b>{total}</b>
      </span>
      <span className="sr-only" aria-live="polite">{`${label} ${clampedIndex + 1} / ${total}`}</span>
      <IconButton
        className="response-navigator-button"
        variant="plain"
        label={`다음 ${label}`}
        symbol="chevron_right"
        symbolSize={21}
        disabled={clampedIndex >= lastIndex}
        onClick={() => onChange(clampedIndex + 1)}
      />
    </div>
  );
}
