import * as React from "react";

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
	variant?: "default" | "secondary" | "destructive" | "outline";
}

export function Badge({
	className = "",
	variant = "default",
	...props
}: BadgeProps) {
  const variants = {
    default: "badge-default", secondary: "badge-secondary",
    destructive: "badge-destructive", outline: "badge-outline",
  };

	return (
		<div
			className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${variants[variant]} ${className}`}
			{...props}
		/>
	);
}
