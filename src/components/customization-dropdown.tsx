import { useState } from "react";
import { Wand2, RefreshCw } from "lucide-react";
import { ActionButton } from "./action-button";
import { Textarea } from "./ui/textarea";

interface CustomizationDropdownProps {
  onModify: (instructions: string) => void;
  onRegenerate: (instructions: string) => void;
  lastGenerated: Date;
  isOpen: boolean;
}

export function CustomizationDropdown({
  onModify,
  onRegenerate,
  lastGenerated,
}: CustomizationDropdownProps) {
  const [instructions, setInstructions] = useState("");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
        <Textarea
          placeholder="Custom instructions (optional)"
          className="min-h-[38px] flex-1 resize-y rounded-md border-[3px] border-black px-3 py-2 text-base font-bold shadow-[4px_4px_0_0_#000000] placeholder:text-base placeholder:font-normal sm:min-h-[46px] sm:px-4 sm:py-3 sm:text-lg sm:placeholder:text-lg"
          value={instructions}
          onChange={(e) => {
            if (e.target.value.length <= 1000) {
              setInstructions(e.target.value);
            }
          }}
          maxLength={1000}
          rows={1}
        />

        <div className="flex flex-row gap-3 sm:gap-4">
          <ActionButton
            onClick={() => onModify(instructions)}
            icon={Wand2}
            tooltipText="Modify existing diagram"
            disabled={!instructions.trim()}
          />
          <ActionButton
            onClick={() => onRegenerate(instructions)}
            icon={RefreshCw}
            tooltipText="Regenerate with/without custom instructions"
          />
        </div>
      </div>

      <div className="flex items-center">
        <span className="text-sm">
          Last generated: {lastGenerated.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
