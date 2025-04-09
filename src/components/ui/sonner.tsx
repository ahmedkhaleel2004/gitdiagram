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
            "group toast group-[.toaster]:bg-purple-100 group-[.toaster]:text-foreground group-[.toaster]:shadow-[3px_3px_0_0_#000000] group-[.toaster]:border-[2px] group-[.toaster]:border-black group-[.toaster]:rounded-md group-[.toaster]:p-3 group-[.toaster]:flex group-[.toaster]:items-center group-[.toaster]:justify-between group-[.toaster]:gap-4",
          title:
            "group-[.toast]:font-bold group-[.toast]:text-base group-[.toast]:m-0",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:!bg-purple-200 group-[.toast]:!border-[2px] group-[.toast]:!border-solid group-[.toast]:!border-black group-[.toast]:!py-[14px] group-[.toast]:!px-6 group-[.toast]:!text-lg group-[.toast]:!text-black group-[.toast]:hover:!bg-purple-300 group-[.toast]:!transition-colors",
          cancelButton:
            "group-[.toast]:text-neutral-500 group-[.toast]:underline hover:group-[.toast]:text-neutral-700",
        },
        duration: 5000,
      }}
      {...props}
    />
  );
};

export { Toaster };
