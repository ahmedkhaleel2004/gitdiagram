import { CopyButton } from "./copy-button";
import { Image as ImageIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";

interface ExportDropdownProps {
  onCopy: () => void;
  lastGenerated?: Date;
  actualCost?: string;
  onExportImage: () => void;
}

export function ExportDropdown({
  onCopy,
  lastGenerated,
  actualCost,
  onExportImage,
}: ExportDropdownProps) {
  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:gap-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={(event) => {
                event.preventDefault();
                onExportImage();
              }}
              className="neo-button h-11 w-full px-3 text-sm sm:h-10 sm:w-auto sm:p-6 sm:px-6 sm:text-lg"
            >
              <ImageIcon className="h-6 w-6" />
              <span className="text-sm">Download PNG</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Download diagram as high-quality PNG</p>
          </TooltipContent>
        </Tooltip>
        <CopyButton onClick={onCopy} />
      </div>

      {lastGenerated ? (
        <div className="flex items-center">
          <span className="text-xs text-gray-700 sm:text-sm dark:text-neutral-300">
            Last generated: {lastGenerated.toLocaleString()}
          </span>
        </div>
      ) : null}
      {actualCost ? (
        <div className="flex items-center">
          <span className="text-xs text-gray-700 sm:text-sm dark:text-neutral-300">
            Actual cost: {actualCost}
          </span>
        </div>
      ) : null}
    </div>
  );
}
