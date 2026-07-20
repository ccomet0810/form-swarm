import type { FormEventHandler } from "react";
import { ControlInput } from "./form-controls";
import { HeaderCommandButton } from "./header-controls";
import { MaterialSymbol } from "./material-symbol";

export function UrlImportForm({
  variant,
  value,
  analyzing,
  disabled,
  autoFocus = false,
  onValueChange,
  onSubmit,
}: {
  variant: "hero" | "command";
  value: string;
  analyzing: boolean;
  disabled: boolean;
  autoFocus?: boolean;
  onValueChange: (value: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  const label = analyzing ? "Google Forms 분석 중" : "Google Forms 검색";
  return (
    <form
      className={`import-form command-field ${variant === "hero" ? "initial-import-form" : "header-command-form"}`}
      onSubmit={onSubmit}
      aria-busy={analyzing}
    >
      <label className="sr-only" htmlFor="form-url">Google Forms 링크</label>
      <ControlInput
        variant="command"
        id="form-url"
        type="url"
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder="Google Forms 링크"
        maxLength={2_048}
        disabled={disabled}
        required
      />
      {variant === "hero" ? (
        <button type="submit" aria-label={label} disabled={disabled}>
          <MaterialSymbol name="search" size={20} />
          <span>{analyzing ? "분석 중" : "검색"}</span>
        </button>
      ) : (
        <HeaderCommandButton label={label} symbol="search" disabled={disabled} />
      )}
    </form>
  );
}
