import type { CSSProperties } from "react";

export type MaterialSymbolName =
  | "auto_awesome"
  | "chevron_left"
  | "chevron_right"
  | "circle"
  | "expand_more"
  | "favorite"
  | "link"
  | "search"
  | "send"
  | "star"
  | "thumb_up";

export function MaterialSymbol({
  name,
  filled = false,
  size = 24,
  className = "",
}: {
  name: MaterialSymbolName;
  filled?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`material-symbol${className ? ` ${className}` : ""}`}
      style={{
        "--symbol-fill": filled ? 1 : 0,
        "--symbol-size": `${size}px`,
      } as CSSProperties}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
