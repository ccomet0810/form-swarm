import type { ReactNode, Ref } from "react";
import { MaterialSymbol, type MaterialSymbolName } from "./material-symbol";

export function HeaderToolButton({
  buttonRef,
  label,
  title,
  symbol,
  filled = false,
  controls,
  expanded,
  disabled = false,
  onClick,
}: {
  buttonRef?: Ref<HTMLButtonElement>;
  label: string;
  title: string;
  symbol: MaterialSymbolName;
  filled?: boolean;
  controls?: string;
  expanded?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      className="header-icon-button"
      type="button"
      aria-label={label}
      aria-controls={controls}
      aria-expanded={expanded}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <MaterialSymbol name={symbol} size={22} filled={filled} />
    </button>
  );
}

export function HeaderCommandPanel({
  id,
  onEscape,
  children,
}: {
  id: string;
  onEscape: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="header-command-row"
      id={id}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onEscape();
      }}
    >
      {children}
    </div>
  );
}

export function HeaderCommandButton({
  label,
  symbol,
  disabled = false,
}: {
  label: string;
  symbol: MaterialSymbolName;
  disabled?: boolean;
}) {
  return (
    <button
      className="header-command-button"
      type="submit"
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      <MaterialSymbol name={symbol} size={21} />
    </button>
  );
}
