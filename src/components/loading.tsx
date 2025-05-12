"use client";

import { useEffect, useState, useRef } from "react";

const messages = [
  "Checking if it's cached...",
  "Generating diagram...",
  "Analyzing repository...",
  "Prompting o3-mini...",
  "Inspecting file paths...",
  "Finding component relationships...",
  "Linking components to code...",
  "Extracting relevant directories...",
  "Reasoning about the diagram...",
  "Prompt engineers needed -> Check out the GitHub",
  "Shoutout to GitIngest for inspiration",
  "I need to find a way to make this faster...",
  "Finding the meaning of life...",
  "I'm tired...",
  "Please just give me the diagram...",
  "...NOW!",
  "guess not...",
];

interface LoadingProps {
  cost?: string;
  status:
    | "idle"
    | "started"
    | "explanation_sent"
    | "explanation"
    | "explanation_chunk"
    | "mapping_sent"
    | "mapping"
    | "mapping_chunk"
    | "diagram_sent"
    | "diagram"
    | "diagram_chunk"
    | "complete"
    | "error";
  explanation?: string;
  mapping?: string;
  diagram?: string;
}

const getStepNumber = (status: string): number => {
  if (status.startsWith("diagram")) return 3;
  if (status.startsWith("mapping")) return 2;
  if (status.startsWith("explanation")) return 1;
  return 0;
};

const SequentialDots = () => {
  return (
    <span className="inline-flex w-8 justify-start">
      <span className="flex gap-0.5">
        <span className="h-1 w-1 animate-[dot1_1.5s_steps(1)_infinite] rounded-full bg-purple-500" />
        <span className="h-1 w-1 animate-[dot2_1.5s_steps(1)_infinite] rounded-full bg-purple-500" />
        <span className="h-1 w-1 animate-[dot3_1.5s_steps(1)_infinite] rounded-full bg-purple-500" />
      </span>
    </span>
  );
};

const StepDots = ({ currentStep }: { currentStep: number }) => {
  return (
    <div className="flex gap-1">
      {[1, 2, 3].map((step) => (
        <div
          key={step}
          className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
            step <= currentStep ? "bg-purple-500" : "bg-purple-200"
          }`}
        />
      ))}
    </div>
  );
};

export default function Loading({
  status = "idle",
  explanation,
  mapping,
  diagram,
  cost,
}: LoadingProps) {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentMessageIndex((prevIndex) => (prevIndex + 1) % messages.length);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  // Auto-scroll effect
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [explanation, mapping, diagram]);

  const shouldShowReasoning = (currentStatus: string) => {
    if (
      currentStatus === "explanation_sent" ||
      (currentStatus.startsWith("explanation") && !explanation)
    ) {
      return "explanation";
    }
    if (
      currentStatus === "mapping_sent" ||
      (currentStatus.startsWith("mapping") && !mapping)
    ) {
      return "mapping";
    }
    if (
      currentStatus === "diagram_sent" ||
      (currentStatus.startsWith("diagram") && !diagram)
    ) {
      return "diagram";
    }
    return null;
  };

  const renderReasoningMessage = () => {
    const reasoningType = shouldShowReasoning(status);
    switch (reasoningType) {
      case "explanation":
        return "Model is analyzing the repository structure and codebase...";
      case "mapping":
        return "Model is identifying component relationships and dependencies...";
      case "diagram":
        return "Model is planning the diagram layout and connections...";
      default:
        return null;
    }
  };

  const getStatusDisplay = () => {
    const reasoningType = shouldShowReasoning(status);
    switch (status) {
      case "explanation_sent":
      case "explanation":
      case "explanation_chunk":
        return {
          text: reasoningType
            ? "Model is reasoning about repository structure"
            : "Explaining repository structure...",
          isReasoning: !!reasoningType,
        };
      case "mapping_sent":
      case "mapping":
      case "mapping_chunk":
        return {
          text: reasoningType
            ? "Model is reasoning about component relationships"
            : "Creating component mapping...",
          isReasoning: !!reasoningType,
        };
      case "diagram_sent":
      case "diagram":
      case "diagram_chunk":
        return {
          text: reasoningType
            ? "Model is reasoning about diagram structure"
            : "Generating diagram...",
          isReasoning: !!reasoningType,
        };
      default:
        return {
          text: messages[currentMessageIndex],
          isReasoning: false,
        };
    }
  };

  const statusDisplay = getStatusDisplay();
  const reasoningMessage = renderReasoningMessage();

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <div className="overflow-hidden rounded-xl border-2 border-purple-200 bg-purple-50/30 backdrop-blur-sm">
        <div className="border-b border-purple-100 bg-purple-100/50 px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-purple-500">
                {statusDisplay.text}
              </span>
              {statusDisplay.isReasoning && <SequentialDots />}
            </div>
            <div className="flex items-center gap-3 text-xs font-medium text-purple-500">
              {cost && <span>Estimated cost: {cost}</span>}
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-purple-100 px-2 py-0.5">
                  Step {getStepNumber(status)}/3
                </span>
                <StepDots currentStep={getStepNumber(status)} />
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div ref={scrollRef} className="max-h-[400px] overflow-y-auto p-6">
          <div className="flex flex-col gap-6">
            {/* Only show reasoning message if we have some content */}
            {reasoningMessage &&
              statusDisplay.isReasoning &&
              (explanation ?? mapping ?? diagram) && (
                <div className="rounded-lg bg-purple-100/50 p-4 text-sm text-purple-500">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">Reasoning</p>
                    <SequentialDots />
                  </div>
                  <p className="mt-2 leading-relaxed">{reasoningMessage}</p>
                </div>
              )}
            {explanation && (
              <div className="rounded-lg bg-white/50 p-4 text-sm text-gray-600">
                <p className="font-medium text-purple-500">Explanation:</p>
                <p className="mt-2 leading-relaxed">{explanation}</p>
              </div>
            )}
            {mapping && (
              <div className="rounded-lg bg-white/50 p-4 text-sm text-gray-600">
                <p className="font-medium text-purple-500">Mapping:</p>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {mapping}
                </pre>
              </div>
            )}
            {diagram && (
              <div className="rounded-lg bg-white/50 p-4 text-sm text-gray-600">
                <p className="font-medium text-purple-500">
                  Mermaid.js diagram:
                </p>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {diagram}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
