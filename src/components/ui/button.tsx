import * as React from "react";

import { cn } from "~/lib/utils";

const BUTTON_BASE_CLASSES =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium ring-offset-background transition-[background-color,border-color,color,opacity,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:active:scale-100 motion-reduce:active:opacity-80 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <button
      className={cn(
        BUTTON_BASE_CLASSES,
        variant === "outline"
          ? "border-input bg-background hover:bg-accent hover:text-accent-foreground border"
          : "bg-primary text-primary-foreground hover:bg-primary/90",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { Button };
