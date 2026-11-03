import * as React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "default" | "outline" | "ghost" | "destructive";
	size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	(
		{ className = "", variant = "default", size = "default", ...props },
		ref,
	) => {
		const baseStyles =
			"inline-flex min-w-11 items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

		const variants = {
			default: "bg-blue-600 text-white hover:bg-blue-700",
			outline: "border border-gray-300 bg-white hover:bg-gray-50",
			ghost: "hover:bg-gray-100",
			destructive: "bg-red-600 text-white hover:bg-red-700",
		};

		const sizes = {
			default: "min-h-11 px-4 py-2",
			sm: "min-h-11 rounded-md px-3 py-2",
			lg: "h-11 rounded-md px-8",
			icon: "h-11 w-11 shrink-0",
		};

		return (
			<button
				ref={ref}
				className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
				{...props}
			/>
		);
	},
);
Button.displayName = "Button";

export { Button };
