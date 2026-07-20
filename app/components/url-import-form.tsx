import type { FormEventHandler } from "react";
import { ControlInput } from "./form-controls";
import { HeaderCommandButton } from "./header-controls";

export function UrlImportForm({
  value,
  analyzing,
  disabled,
  autoFocus = false,
  onValueChange,
  onSubmit,
}: {
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
      className="import-form command-field header-command-form"
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
      <HeaderCommandButton label={label} symbol="search" disabled={disabled} />
    </form>
  );
}
