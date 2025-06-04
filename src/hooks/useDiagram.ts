import { useState, useEffect, useCallback } from "react";
import {
  cacheDiagramAndExplanation,
  getCachedDiagram,
} from "~/app/_actions/cache";
import { getLastGeneratedDate } from "~/app/_actions/repo";
import { getCostOfGeneration } from "~/lib/fetch-backend";
import { exampleRepos } from "~/lib/exampleRepos";

interface StreamState {
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
  message?: string;
  explanation?: string;
  mapping?: string;
  diagram?: string;
  error?: string;
}

interface StreamResponse {
  status: StreamState["status"];
  message?: string;
  chunk?: string;
  explanation?: string;
  mapping?: string;
  diagram?: string;
  error?: string;
}

export function useDiagram(username: string, repo: string) {
  const [diagram, setDiagram] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [lastGenerated, setLastGenerated] = useState<Date | undefined>();
  const [cost, setCost] = useState<string>("");
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  // const [tokenCount, setTokenCount] = useState<number>(0);
  const [state, setState] = useState<StreamState>({ status: "idle" });
  const [hasUsedFreeGeneration, setHasUsedFreeGeneration] = useState<boolean>(
    () => {
      if (typeof window === "undefined") return false;
      return localStorage.getItem("has_used_free_generation") === "true";
    },
  );

  // Function to process click events in Mermaid diagram
  const processClickEvents = useCallback((diagramCode: string, username: string, repo: string, branch: string = "main") => {
    const replaceClickEvent = (match: string, componentName: string, path: string) => {
      // Remove quotes from path
      const cleanPath = path.replace(/^["']|["']$/g, '');
      
      // Determine if path is likely a file (has extension) or directory
      const isFile = cleanPath.split('/').pop()?.includes('.') ?? false;
      
      // Construct GitHub URL
      const baseUrl = `https://github.com/${username}/${repo}`;
      const pathType = isFile ? 'blob' : 'tree';
      const fullUrl = `${baseUrl}/${pathType}/${branch}/${cleanPath}`;
      
      return `click ${componentName} "${fullUrl}"`;
    };

    // Match click events: click ComponentName "path/to/something"
    const clickPattern = /click\s+([^\s"]+)\s+"([^"]+)"/g;
    return diagramCode.replace(clickPattern, replaceClickEvent);
  }, []);

  const generateDiagram = useCallback(
    async (instructions = "", githubPat?: string, clearCache = false) => {
      setState({
        status: "started",
        message: "Starting generation process...",
      });

      try {
        const baseUrl =
          process.env.NEXT_PUBLIC_API_DEV_URL ?? "https://api.gitdiagram.com";
        
        // Log environment variable and final URL for debugging
        console.log("🔧 Frontend Environment:");
        console.log("  NEXT_PUBLIC_API_DEV_URL:", process.env.NEXT_PUBLIC_API_DEV_URL);
        console.log("  Final API baseUrl:", baseUrl);
        console.log("  Clear cache:", clearCache);
        
        const response = await fetch(`${baseUrl}/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username,
            repo,
            instructions,
            api_key: localStorage.getItem("openai_key") ?? undefined,
            github_pat: githubPat,
            clear_cache: clearCache,
          }),
        });
        if (!response.ok) {
          throw new Error("Failed to start streaming");
        }
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No reader available");
        }

        let explanation = "";
        let mapping = "";
        let diagram = "";

        // Process the stream
        const processStream = async () => {
          let buffer = ""; // Buffer to store incomplete lines
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              // Convert the chunk to text and add to buffer
              const chunk = new TextDecoder().decode(value);
              buffer += chunk;
              
              // Split buffer into lines
              const lines = buffer.split("\n");
              
              // Keep the last potentially incomplete line in buffer
              buffer = lines.pop() || "";

              // Process each complete SSE message
              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  try {
                    const jsonStr = line.slice(6);
                    // Skip empty data lines
                    if (!jsonStr.trim()) continue;
                    
                    const data = JSON.parse(jsonStr) as StreamResponse;

                    // If we receive an error, set loading to false immediately
                    if (data.error) {
                      setState({ status: "error", error: data.error });
                      setLoading(false);
                      return; // Add this to stop processing
                    }

                    // Update state based on the message type
                    switch (data.status) {
                      case "started":
                        setState((prev) => ({
                          ...prev,
                          status: "started",
                          message: data.message,
                        }));
                        break;
                      case "explanation_sent":
                        setState((prev) => ({
                          ...prev,
                          status: "explanation_sent",
                          message: data.message,
                        }));
                        break;
                      case "explanation":
                        setState((prev) => ({
                          ...prev,
                          status: "explanation",
                          message: data.message,
                        }));
                        break;
                      case "explanation_chunk":
                        if (data.chunk) {
                          explanation += data.chunk;
                          setState((prev) => ({ ...prev, explanation }));
                        }
                        break;
                      case "mapping_sent":
                        setState((prev) => ({
                          ...prev,
                          status: "mapping_sent",
                          message: data.message,
                        }));
                        break;
                      case "mapping":
                        setState((prev) => ({
                          ...prev,
                          status: "mapping",
                          message: data.message,
                        }));
                        break;
                      case "mapping_chunk":
                        if (data.chunk) {
                          mapping += data.chunk;
                          setState((prev) => ({ ...prev, mapping }));
                        }
                        break;
                      case "diagram_sent":
                        setState((prev) => ({
                          ...prev,
                          status: "diagram_sent",
                          message: data.message,
                        }));
                        break;
                      case "diagram":
                        setState((prev) => ({
                          ...prev,
                          status: "diagram",
                          message: data.message,
                        }));
                        break;
                      case "diagram_chunk":
                        if (data.chunk) {
                          diagram += data.chunk;
                          setState((prev) => ({ ...prev, diagram }));
                        }
                        break;
                      case "complete":
                        // Use accumulated content instead of expecting it in the response
                        // Apply click event processing to the final diagram
                        const processedDiagram = processClickEvents(diagram, username, repo, "main");
                        
                        setState({
                          status: "complete",
                          explanation: explanation,
                          diagram: processedDiagram,
                          message: data.message,
                        });
                        const date = await getLastGeneratedDate(username, repo);
                        setLastGenerated(date ?? undefined);
                        if (!hasUsedFreeGeneration) {
                          localStorage.setItem(
                            "has_used_free_generation",
                            "true",
                          );
                          setHasUsedFreeGeneration(true);
                        }
                        break;
                      case "error":
                        setState({ status: "error", error: data.error });
                        break;
                    }
                  } catch (e) {
                    console.error("Error parsing SSE message:", e);
                    console.error("Raw line:", line);
                    console.error("JSON string:", line.slice(6));
                    // Don't throw here, just continue processing other messages
                  }
                }
              }
            }
            
            // Process any remaining buffered content after stream ends
            if (buffer.trim() && buffer.startsWith("data: ")) {
              try {
                const jsonStr = buffer.slice(6);
                if (jsonStr.trim()) {
                  const data = JSON.parse(jsonStr) as StreamResponse;
                  // Handle final message if needed
                  if (data.error) {
                    setState({ status: "error", error: data.error });
                  }
                }
              } catch (e) {
                console.error("Error parsing final buffered SSE message:", e);
                console.error("Buffered content:", buffer);
              }
            }
          } finally {
            reader.releaseLock();
          }
        };

        await processStream();
      } catch (error) {
        setState({
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "An unknown error occurred",
        });
        setLoading(false);
      }
    },
    [username, repo, hasUsedFreeGeneration, processClickEvents],
  );

  useEffect(() => {
    if (state.status === "complete" && state.diagram) {
      // Cache the completed diagram with the usedOwnKey flag
      const hasApiKey = !!localStorage.getItem("openai_key");
      void cacheDiagramAndExplanation(
        username,
        repo,
        state.diagram,
        state.explanation ?? "No explanation provided",
        hasApiKey,
      );
      setDiagram(state.diagram);
      setLoading(false);
      void getLastGeneratedDate(username, repo).then((date) =>
        setLastGenerated(date ?? undefined),
      );
    } else if (state.status === "error") {
      setLoading(false);
    }
  }, [state.status, state.diagram, username, repo, state.explanation]);

  const getDiagram = useCallback(async () => {
    setLoading(true);
    setError("");
    setCost("");

    try {
      // Check cache first - always allow access to cached diagrams
      const cached = await getCachedDiagram(username, repo);
      const github_pat = localStorage.getItem("github_pat");

      if (cached) {
        setDiagram(cached);
        const date = await getLastGeneratedDate(username, repo);
        setLastGenerated(date ?? undefined);
        return;
      }

      // TEMP: LET USERS HAVE INFINITE GENERATIONS
      // Only check for API key if we need to generate a new diagram
      // const storedApiKey = localStorage.getItem("openai_key");
      // if (hasUsedFreeGeneration && !storedApiKey) {
      //   setError(
      //     "You've used your one free diagram. Please enter your API key to continue. As a student, I can't afford to keep it totally free and I hope you understand :)",
      //   );
      //   setState({ status: "error", error: "API key required" });
      //   return;
      // }

      // Get cost estimate
      const costEstimate = await getCostOfGeneration(
        username,
        repo,
        "",
        github_pat ?? undefined,
        false, // Don't clear cache for initial cost estimate
      );

      if (costEstimate.error) {
        console.error("Cost estimation failed:", costEstimate.error);
        // if (costEstimate.requires_api_key) {
        //   setTokenCount(costEstimate.token_count ?? 0);
        // }
        // TODO: come to think of it, why is requires api key based on tokens? this unimplemented option is smarter. Add API key dialog
        setError(costEstimate.error);
        return;
      }

      setCost(costEstimate.cost ?? "");

      // Start streaming generation
      await generateDiagram("", github_pat ?? undefined, false);

      // Note: The diagram and lastGenerated will be set by the generateDiagram function
      // through the state updates
    } catch (error) {
      console.error("Error in getDiagram:", error);
      setError("Something went wrong. Please try again later.");
    } finally {
      setLoading(false);
    }
  }, [username, repo, generateDiagram]);

  useEffect(() => {
    void getDiagram();
  }, [getDiagram]);

  const isExampleRepo = (repoName: string): boolean => {
    return Object.values(exampleRepos).some((value) =>
      value.includes(repoName),
    );
  };

  const handleModify = async (instructions: string) => {
    if (isExampleRepo(repo)) {
      setError("Example repositories cannot be modified.");
      return;
    }

    setLoading(true);
    setError("");
    setCost("");
    try {
      // Start streaming generation with instructions
      await generateDiagram(instructions, undefined, false);
    } catch (error) {
      console.error("Error modifying diagram:", error);
      setError("Failed to modify diagram. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async (instructions: string) => {
    if (isExampleRepo(repo)) {
      setError("Example repositories cannot be regenerated.");
      return;
    }

    setLoading(true);
    setError("");
    setCost("");
    try {
      const github_pat = localStorage.getItem("github_pat");

      // TEMP: LET USERS HAVE INFINITE GENERATIONS
      // const storedApiKey = localStorage.getItem("openai_key");

      // Check if user has used their free generation and doesn't have an API key
      // if (hasUsedFreeGeneration && !storedApiKey) {
      //   setError(
      //     "You've used your one free diagram. Please enter your API key to continue. As a student, I can't afford to keep it totally free and I hope you understand :)",
      //   );
      //   setLoading(false);
      //   return;
      // }

      const costEstimate = await getCostOfGeneration(username, repo, "", undefined, false);

      if (costEstimate.error) {
        console.error("Cost estimation failed:", costEstimate.error);
        setError(costEstimate.error);
        return;
      }

      setCost(costEstimate.cost ?? "");

      // Start streaming generation with instructions
      await generateDiagram(instructions, github_pat ?? undefined, false);
    } catch (error) {
      console.error("Error regenerating diagram:", error);
      setError("Failed to regenerate diagram. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(diagram);
    } catch (error) {
      console.error("Error copying to clipboard:", error);
    }
  };

  const handleExportImage = () => {
    const svgElement = document.querySelector(".mermaid svg");
    if (!(svgElement instanceof SVGSVGElement)) return;

    try {
      const canvas = document.createElement("canvas");
      const scale = 4;

      const bbox = svgElement.getBBox();
      const transform = svgElement.getScreenCTM();
      if (!transform) return;

      const width = Math.ceil(bbox.width * transform.a);
      const height = Math.ceil(bbox.height * transform.d);
      canvas.width = width * scale;
      canvas.height = height * scale;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const svgData = new XMLSerializer().serializeToString(svgElement);
      const img = new Image();

      img.onload = () => {
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, width, height);

        const a = document.createElement("a");
        a.download = "diagram.png";
        a.href = canvas.toDataURL("image/png", 1.0);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };

      img.src =
        "data:image/svg+xml;base64," +
        btoa(unescape(encodeURIComponent(svgData)));
    } catch (error) {
      console.error("Error generating PNG:", error);
    }
  };

  const handleApiKeySubmit = async (apiKey: string) => {
    setShowApiKeyDialog(false);
    setLoading(true);
    setError("");

    // Store the key first
    localStorage.setItem("openai_key", apiKey);

    // Then generate diagram using stored key
    const github_pat = localStorage.getItem("github_pat");
    try {
      await generateDiagram("", github_pat ?? undefined, false);
    } catch (error) {
      console.error("Error generating with API key:", error);
      setError("Failed to generate diagram with provided API key.");
    } finally {
      setLoading(false);
    }
  };

  const handleCloseApiKeyDialog = () => {
    setShowApiKeyDialog(false);
  };

  const handleOpenApiKeyDialog = () => {
    setShowApiKeyDialog(true);
  };

  const handleClearCache = async () => {
    setLoading(true);
    setError("");
    setCost("");
    try {
      const github_pat = localStorage.getItem("github_pat");
      console.log("🗑️ Clearing cache and regenerating diagram...");
      
      // Regenerate with cache clearing enabled
      await generateDiagram("", github_pat ?? undefined, true);
    } catch (error) {
      console.error("Error clearing cache and regenerating:", error);
      setError("Failed to clear cache and regenerate diagram. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  return {
    diagram,
    error,
    loading,
    lastGenerated,
    cost,
    handleModify,
    handleRegenerate,
    handleCopy,
    showApiKeyDialog,
    // tokenCount,
    handleApiKeySubmit,
    handleCloseApiKeyDialog,
    handleOpenApiKeyDialog,
    handleExportImage,
    state,
    handleClearCache,
  };
}
