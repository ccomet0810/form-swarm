import type { ReactNode } from "react";
import { MaterialSymbol } from "./material-symbol";

export function InfoDetails({
  children,
  variant = "inline",
}: {
  children: ReactNode;
  variant?: "inline" | "card-row";
}) {
  return (
    <details className={`info-details${variant === "card-row" ? " info-details--card-row" : ""}`}>
      <summary>
        <MaterialSymbol name="expand_more" size={18} className="info-details-chevron" />
        <span>정보</span>
      </summary>
      <dl className="question-meta">{children}</dl>
    </details>
  );
}
