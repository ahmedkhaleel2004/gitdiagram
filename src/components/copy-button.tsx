import React, { useState } from "react";
import { Button } from "~/components/ui/button";
import { FileText, Check } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";

interface CopyButtonProps {
  onClick: () => void;
}

export function CopyButton({ onClick }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = () => {
    onClick();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000); // Reset after 2 seconds
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={handleClick}
            className="border-[3px] border-black bg-purple-400 p-4 px-4 text-base text-black shadow-[4px_4px_0_0_#000000] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 hover:transform hover:bg-purple-400 sm:p-6 sm:px-6 sm:text-lg"
            tabIndex={0}
          >
            {copied ? (
              <>
                <Check className="h-6 w-6" role="img" aria-label="Copied!"/>
                <span className="text-sm">Copied!</span>
              </>
            ) : (
              <>
                <FileText className="h-6 w-6" role="img" aria-label="Copy Mermaid.js Code"/>
                <span className="text-sm">Copy Mermaid.js Code</span>
              </>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {copied
              ? "Copied!"
              : "Copy the internal Mermaid.js code needed to generate the diagram"}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
