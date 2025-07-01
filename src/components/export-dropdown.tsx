import { CopyButton } from "./copy-button";
import { Image } from "lucide-react";
import { ActionButton } from "./action-button";

interface ExportDropdownProps {
  onCopy: () => void;
  lastGenerated: Date;
  onExportImage: () => void;
  isOpen: boolean;
}

export function ExportDropdown({
  onCopy,
  lastGenerated,
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

      <div className="flex items-center">
        <span className="text-sm">
          Last generated: {lastGenerated.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
