import { CopyButton } from "./copy-button";
import { Image } from "lucide-react";
import { ActionButton } from "./action-button";

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
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
        <ActionButton
          onClick={onExportImage}
          icon={Image}
          tooltipText="Download diagram as high-quality PNG"
          text="Download PNG"
        />
        <CopyButton onClick={onCopy} />
      </div>

      {lastGenerated ? (
        <div className="flex items-center">
          <span className="text-sm text-gray-700 dark:text-neutral-300">
            Last generated: {lastGenerated.toLocaleString()}
          </span>
        </div>
      ) : null}
      {actualCost ? (
        <div className="flex items-center">
          <span className="text-sm text-gray-700 dark:text-neutral-300">
            Actual cost: {actualCost}
          </span>
        </div>
      ) : null}
    </div>
  );
}
