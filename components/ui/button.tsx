import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-cyan-400 text-slate-950 shadow-sm shadow-cyan-950/20 hover:bg-cyan-300",
  secondary:
    "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-base",
};

export function buttonClassName({
  className,
  variant = "primary",
  size = "md",
}: {
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
} = {}) {
  return cn(
    "inline-flex items-center justify-center rounded-md font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName({ className, variant, size })}
      {...props}
    />
  );
}
