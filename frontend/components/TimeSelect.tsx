"use client";

import { buildTimeOptions, formatTimeValue } from "@/lib/dates";

type TimeSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options?: string[];
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  required?: boolean;
};

export default function TimeSelect({
  ariaLabel,
  className = "sport-field w-full",
  disabled = false,
  id,
  onChange,
  options = buildTimeOptions(),
  placeholder = "Choose a time",
  required = false,
  value,
}: TimeSelectProps) {
  return (
    <select
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
      id={id}
      onChange={(event) => onChange(event.target.value)}
      required={required}
      value={value}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {formatTimeValue(option)}
        </option>
      ))}
    </select>
  );
}

export function TimeSelectField({ label, ...props }: TimeSelectProps & { label: string }) {
  return (
    <label className="block text-sm font-semibold text-sportNavy" htmlFor={props.id}>
      <span className="mb-1.5 block">{label}</span>
      <TimeSelect {...props} ariaLabel={props.ariaLabel || label} />
    </label>
  );
}
