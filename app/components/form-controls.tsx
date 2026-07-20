"use client";

import {
  useLayoutEffect,
  useRef,
  type ComponentPropsWithRef,
} from "react";
import { MaterialSymbol, type MaterialSymbolName } from "./material-symbol";

type ControlVariant = "editor" | "command";

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function ControlInput({
  variant = "editor",
  className,
  ...props
}: ComponentPropsWithRef<"input"> & { variant?: ControlVariant }) {
  return (
    <input
      {...props}
      className={classNames("control", "field-line", "control--text", "control--input", `control--${variant}`, className)}
    />
  );
}

export function ControlSelect({
  variant = "editor",
  className,
  wrapperClassName,
  disabled,
  ...props
}: ComponentPropsWithRef<"select"> & {
  variant?: ControlVariant;
  wrapperClassName?: string;
}) {
  return (
    <span
      className={classNames("select-control", `select-control--${variant}`, wrapperClassName)}
      data-disabled={disabled ? "" : undefined}
    >
      <select
        {...props}
        disabled={disabled}
        className={classNames("control", "control--select", `control--${variant}`, className)}
      />
      <MaterialSymbol name="expand_more" size={20} className="select-control-icon" />
    </span>
  );
}

export function ControlTextarea({
  variant = "editor",
  className,
  ...props
}: ComponentPropsWithRef<"textarea"> & { variant?: ControlVariant }) {
  return (
    <textarea
      {...props}
      className={classNames("control", "field-line", "control--text", "control--textarea", `control--${variant}`, className)}
    />
  );
}

export function IconButton({
  label,
  symbol,
  filled = false,
  symbolSize = 22,
  variant = "plain",
  className,
  title,
  type,
  ...props
}: Omit<ComponentPropsWithRef<"button">, "children" | "aria-label"> & {
  label: string;
  symbol: MaterialSymbolName;
  filled?: boolean;
  symbolSize?: number;
  variant?: "plain" | "outlined" | "joined";
}) {
  return (
    <button
      {...props}
      className={classNames(className, "icon-button", `icon-button--${variant}`)}
      type={type ?? "button"}
      aria-label={label}
      title={title ?? label}
    >
      <MaterialSymbol name={symbol} size={symbolSize} filled={filled} />
    </button>
  );
}

export function AutoGrowTextarea({
  id,
  value,
  onValueChange,
  ariaDescribedBy,
  placeholder,
  maxLength,
  invalid = false,
}: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  ariaDescribedBy?: string;
  placeholder?: string;
  maxLength?: number;
  invalid?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => {
      element.style.height = "auto";
      const styles = window.getComputedStyle(element);
      const borderHeight =
        Number.parseFloat(styles.borderTopWidth) +
        Number.parseFloat(styles.borderBottomWidth);
      element.style.height = `${element.scrollHeight + borderHeight}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [value]);

  return (
    <ControlTextarea
      ref={ref}
      id={id}
      rows={1}
      value={value}
      aria-describedby={ariaDescribedBy}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(event) => onValueChange(event.target.value)}
    />
  );
}
