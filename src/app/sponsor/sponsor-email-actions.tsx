"use client";

import Link from "next/link";
import { ArrowUpRight, Check, Copy, Mail } from "lucide-react";
import { useState } from "react";
import { cn } from "~/lib/utils";

type SponsorEmailActionsProps = {
  email: string;
  mailto: string;
  className?: string;
};

export function SponsorEmailActions({
  email,
  mailto,
  className,
}: SponsorEmailActionsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.location.href = mailto;
    }
  };

  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row", className)}>
      <Link
        href={mailto}
        className="neo-button inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-black"
      >
        <Mail className="h-4 w-4" aria-hidden="true" />
        Email Ahmed to sponsor
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </Link>
      <button
        type="button"
        onClick={handleCopy}
        className="browse-muted-button inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-black"
      >
        {copied ? (
          <Check className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Copy className="h-4 w-4" aria-hidden="true" />
        )}
        {copied ? "Copied email" : "Copy email"}
      </button>
    </div>
  );
}
