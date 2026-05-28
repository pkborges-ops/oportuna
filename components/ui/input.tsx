import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  helperText?: string;
};

export function Input({ className, label, helperText, id, ...props }: InputProps) {
  const inputId = id ?? props.name;

  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      {label ? <span>{label}</span> : null}
      <input
        id={inputId}
        className={cn(
          "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition",
          "placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100",
          className,
        )}
        {...props}
      />
      {helperText ? (
        <span className="text-xs font-normal text-slate-500">{helperText}</span>
      ) : null}
    </label>
  );
}
