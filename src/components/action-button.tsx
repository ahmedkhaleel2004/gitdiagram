import { Button } from "~/components/ui/button";
import type { LucideIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";

interface ActionButtonProps {
  onClick: () => void;
  icon: LucideIcon;
  tooltipText: string;
  disabled?: boolean;
  text?: string;
}

export function ActionButton({
  onClick,
  icon: Icon,
  tooltipText,
  disabled,
  text,
}: ActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          onClick={(e) => {
            e.preventDefault();
            onClick();
          }}
          disabled={disabled}
          className="neo-button p-4 px-4 text-base sm:p-6 sm:px-6 sm:text-lg"
        >
          <Icon className="h-6 w-6" />
          {text && <span className="text-sm">{text}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  );
}
