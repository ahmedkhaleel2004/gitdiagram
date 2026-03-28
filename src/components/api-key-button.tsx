import { Key } from "lucide-react";
import { Button } from "./ui/button";

interface ApiKeyButtonProps {
  onClick: () => void;
}

export function ApiKeyButton({ onClick }: ApiKeyButtonProps) {
  return (
    <Button
      onClick={onClick}
      className="neo-button px-4 py-2"
    >
      <Key className="mr-2 h-5 w-5" />
      Use Your AI Key
    </Button>
  );
}
