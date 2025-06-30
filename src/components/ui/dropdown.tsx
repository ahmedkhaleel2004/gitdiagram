"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { useEffect } from "react";

interface DropdownProps {
  branches: string[];
  selectedBranch: string | null;
  onSelectBranch: (branch: string) => void;
  loadingBranches: boolean;
  setError: (error: string) => void;
}

export const Dropdown: React.FC<DropdownProps> = ({
  branches,
  selectedBranch,
  onSelectBranch,
  loadingBranches,
  setError
}) => {
  const [open, setOpen] = React.useState(false);
  const [shouldOpen, setShouldOpen] = React.useState(false);
  // this effect is used to check if the dropdown should open
  //depending on if the branches array is empty or not
  // if branches are empty, we don't allow the dropdown to open
  // if branches are not empty, we allow the dropdown to open
  // this is useful to prevent the dropdown from opening when there are no branches
  // and to avoid unnecessary API calls or UI updates
  useEffect(() => {
    if (branches.length) {
      setShouldOpen(true);
      setError(""); // Clear error when branches are available
    } else {
      setShouldOpen(false);
      setOpen(false); // Close the dropdown if branches are empty
      // Do not reset selectedBranch here; let parent control it
    }
  },[branches, setError]);

  // Show error if user tries to open dropdown with no branches
  const handleOpenChange = (nextOpen: boolean) => {
    if (loadingBranches) return; // Prevent opening while loading branches
    if (nextOpen && !shouldOpen) {
      // Show error (could use a toast, alert, or set a parent error state)
      setError("Please enter a valid GitHub repository URL first.");
      setOpen(false);
      return;
    }
    setOpen(nextOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={loadingBranches || !shouldOpen}
          className="text-md text-md w-full justify-between overflow-y-hidden overflow-x-clip border-[3px] border-black p-4 px-4 text-black shadow-[4px_4px_0_0_#000000] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 hover:transform hover:bg-gray-100 max-sm:w-full sm:p-6 sm:px-6"
        >
          {loadingBranches && branches.length > 0
            ? "Loading branches..."
            : selectedBranch
              ? selectedBranch
              : "Select Branch..."}
          <ChevronsUpDown className="ml-2 h-5 w-5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="border-2 border-black shadow-[4px_4px_0_0_#000000]">
        <Command className="">
          <CommandInput placeholder="Search branch..." className="h-9" />
          <CommandList>
            {branches.length === 0 ? (
              <CommandEmpty>No branches found.</CommandEmpty>
            ) : (
              <CommandGroup>
                {branches.map((branch) => (
                  <CommandItem
                    key={branch}
                    value={branch}
                    onSelect={() => {
                      onSelectBranch(branch);
                      setOpen(false);
                    }}
                  >
                    {branch}
                    <Check
                      className={cn(
                        "ml-auto",
                        selectedBranch === branch ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
