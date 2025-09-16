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
  loadingMoreBranches?: boolean;
  hasMoreBranches?: boolean;
  onLoadMore: () => void;
  setError: (error: string) => void;
}

export const Dropdown: React.FC<DropdownProps> = ({
  branches,
  selectedBranch,
  onSelectBranch,
  loadingBranches,
  loadingMoreBranches = false,
  hasMoreBranches = false,
  onLoadMore,
  setError,
}) => {
  const [open, setOpen] = React.useState(false);
  const [shouldOpen, setShouldOpen] = React.useState(false);
  useEffect(() => {
    if (branches.length) {
      setShouldOpen(true);
      setError("");
    } else {
      setShouldOpen(false);
      setOpen(false);
    }
  }, [branches, setError]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (loadingMoreBranches || !hasMoreBranches) return;

    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    
    if (distanceFromBottom <= 100) {
      onLoadMore();
    }
  };

  // Show error if user tries to open dropdown with no branches
  const handleOpenChange = (nextOpen: boolean) => {
    if (loadingBranches) return; 
    if (nextOpen && !shouldOpen) {
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
          {loadingBranches && !branches.length
            ? "Loading branches..."
            : selectedBranch
              ? selectedBranch
              : "Select Branch..."}
          <ChevronsUpDown className="ml-2 h-5 w-5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="border-2 border-black shadow-[4px_4px_0_0_#000000]">
        <Command className="">
          <CommandInput placeholder="Search branch..." className="h-9"/>
          <CommandList onScroll={handleScroll}>
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
            {hasMoreBranches && (
              <div className="border-t border-gray-200 p-2 text-center text-sm text-gray-500">
                {loadingMoreBranches
                  ? "Loading more branches..."
                  : "End of list"}
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
