import type { ReactNode, Ref } from "react";
import { IconButton } from "./form-controls";
import type { MaterialSymbolName } from "./material-symbol";

export function HeaderToolButton({
  buttonRef,
  label,
  title,
  symbol,
  filled = false,
  controls,
  expanded,
  busy = false,
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
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <IconButton
      ref={buttonRef}
      className="header-icon-button"
      variant="plain"
      label={label}
      symbol={symbol}
      symbolSize={22}
      filled={filled}
      aria-controls={controls}
      aria-expanded={expanded}
      aria-busy={busy || undefined}
      title={title}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

export function HeaderCommandSlot({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="header-command-slot" id={id}>
      {children}
    </div>
  );
}

export function HeaderCommandBackButton({
  label,
  disabled = false,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <IconButton
      className="header-command-back"
      variant="plain"
      label={label}
      symbol="chevron_left"
      symbolSize={22}
      disabled={disabled}
      onClick={onClick}
    />
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
    <IconButton
      className="header-command-button"
      type="submit"
      variant="joined"
      label={label}
      symbol={symbol}
      symbolSize={21}
      disabled={disabled}
    />
  );
}
