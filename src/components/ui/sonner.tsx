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
            "toast !bg-purple-100 !text-black !shadow-[3px_3px_0_0_#000000] !border-[2px] !border-black !rounded-md !p-3 !flex !items-center !justify-between !gap-4",
          title: "font-bold text-base m-0",
          description: "text-muted-foreground",
          actionButton:
            "!bg-purple-200 !border-[2px] !border-solid !border-black !py-[14px] !px-6 !text-lg !text-black hover:!bg-purple-300 !transition-colors !cursor-pointer",
          cancelButton:
            "text-neutral-500 underline hover:text-neutral-700",
        },
        duration: 5000,
      }}
      {...props}
    />
  );
};

export { Toaster };
