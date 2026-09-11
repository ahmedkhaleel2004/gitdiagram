"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "toast !bg-purple-100 dark:!bg-[#1a1228] !text-black dark:!text-[hsl(var(--foreground))] !shadow-[3px_3px_0_0_#000000] dark:!shadow-[3px_3px_0_0_#0d0a19] !border-[2px] !border-black dark:!border-[#2d1d4e] !rounded-md !p-3 !flex !items-center !justify-between !gap-4",
          title: "font-bold text-base m-0",
          description:
            "text-muted-foreground dark:!text-[hsl(var(--muted-foreground))]",
          actionButton:
            "!bg-purple-200 dark:!bg-[hsl(var(--neo-button))] !border-[2px] !border-solid !border-black dark:!border-[#2d1d4e] !py-[14px] !px-6 !text-lg !text-black hover:!bg-purple-300 dark:hover:!bg-[hsl(var(--neo-button-hover))] !transition-colors !cursor-pointer",
          cancelButton:
            "text-neutral-500 underline hover:text-neutral-700 dark:text-[hsl(var(--muted-foreground))] dark:hover:text-[hsl(var(--foreground))]",
        },
        duration: 5000,
      }}
      {...props}
    />
  );
};

export { Toaster };
