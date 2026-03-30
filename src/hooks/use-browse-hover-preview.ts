"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { BrowseIndexEntry } from "~/features/browse/catalog";
import { preloadBrowseDiagramPreviewChart } from "~/components/browse-diagram-preview";
import {
  diagramPreviewCache,
  getHoverPreviewPosition,
  HOVER_PREVIEW_MEDIA_QUERY,
  HOVER_PREVIEW_OPEN_DELAY_MS,
  type HoverPreviewState,
  type HoverPreviewStatus,
} from "~/components/browse-catalog-shared";

interface UseBrowseHoverPreviewParams {
  initialPreviewDiagrams?: Record<string, string>;
}

interface PointerPosition {
  clientX: number;
  clientY: number;
}

export function useBrowseHoverPreview({
  initialPreviewDiagrams,
}: UseBrowseHoverPreviewParams) {
  const [desktopHoverEnabled, setDesktopHoverEnabled] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(
    null,
  );
  const [hoverPreviewDiagram, setHoverPreviewDiagram] = useState<string | null>(
    null,
  );
  const [hoverPreviewStatus, setHoverPreviewStatus] =
    useState<HoverPreviewStatus>("idle");
  const hoverIntentTimeoutRef = useRef<number | null>(null);
  const hoverRequestControllerRef = useRef<AbortController | null>(null);
  const activeHoverPreviewKeyRef = useRef<string | null>(null);
  const hoverPreviewElementRef = useRef<HTMLDivElement | null>(null);
  const hoverPreviewAnimationFrameRef = useRef<number | null>(null);
  const hoverPreviewPositionRef = useRef<{ left: number; top: number } | null>(
    null,
  );

  const clearHoverIntentTimeout = useCallback(() => {
    if (hoverIntentTimeoutRef.current !== null) {
      window.clearTimeout(hoverIntentTimeoutRef.current);
      hoverIntentTimeoutRef.current = null;
    }
  }, []);

  const cancelHoverPreviewAnimationFrame = useCallback(() => {
    if (hoverPreviewAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverPreviewAnimationFrameRef.current);
      hoverPreviewAnimationFrameRef.current = null;
    }
  }, []);

  const applyHoverPreviewPosition = useCallback(
    (position: { left: number; top: number }) => {
      hoverPreviewPositionRef.current = position;
      hoverPreviewElementRef.current?.style.setProperty(
        "transform",
        `translate3d(${position.left}px, ${position.top}px, 0)`,
      );
    },
    [],
  );

  const closeHoverPreview = useCallback(() => {
    clearHoverIntentTimeout();
    cancelHoverPreviewAnimationFrame();
    hoverRequestControllerRef.current?.abort();
    hoverRequestControllerRef.current = null;
    activeHoverPreviewKeyRef.current = null;
    hoverPreviewPositionRef.current = null;
    setHoverPreview(null);
    setHoverPreviewDiagram(null);
    setHoverPreviewStatus("idle");
  }, [cancelHoverPreviewAnimationFrame, clearHoverIntentTimeout]);

  useEffect(() => {
    if (!initialPreviewDiagrams) {
      return;
    }

    for (const [key, diagram] of Object.entries(initialPreviewDiagrams)) {
      diagramPreviewCache.set(key, diagram);
    }
  }, [initialPreviewDiagrams]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQuery = window.matchMedia(HOVER_PREVIEW_MEDIA_QUERY);
    const updateDesktopHoverState = () => {
      setDesktopHoverEnabled(mediaQuery.matches);
    };

    updateDesktopHoverState();
    mediaQuery.addEventListener?.("change", updateDesktopHoverState);

    return () => {
      mediaQuery.removeEventListener?.("change", updateDesktopHoverState);
    };
  }, []);

  useEffect(() => {
    if (desktopHoverEnabled) {
      if (
        initialPreviewDiagrams &&
        Object.keys(initialPreviewDiagrams).length > 0
      ) {
        preloadBrowseDiagramPreviewChart();
      }
      return;
    }

    closeHoverPreview();
  }, [closeHoverPreview, desktopHoverEnabled, initialPreviewDiagrams]);

  useEffect(() => {
    if (!hoverPreview) {
      return;
    }

    const hidePreview = () => closeHoverPreview();
    window.addEventListener("scroll", hidePreview, true);
    window.addEventListener("resize", hidePreview);

    return () => {
      window.removeEventListener("scroll", hidePreview, true);
      window.removeEventListener("resize", hidePreview);
    };
  }, [closeHoverPreview, hoverPreview]);

  useEffect(() => {
    return () => {
      closeHoverPreview();
    };
  }, [closeHoverPreview]);

  useEffect(() => {
    if (!hoverPreview) {
      return;
    }

    applyHoverPreviewPosition(
      hoverPreviewPositionRef.current ?? {
        left: hoverPreview.left,
        top: hoverPreview.top,
      },
    );
  }, [
    applyHoverPreviewPosition,
    hoverPreview,
    hoverPreviewDiagram,
    hoverPreviewStatus,
  ]);

  const loadHoverPreview = useCallback(
    async ({
      key,
      repo,
      username,
    }: {
      key: string;
      repo: string;
      username: string;
    }) => {
      const cachedDiagram = diagramPreviewCache.get(key);
      if (cachedDiagram) {
        startTransition(() => {
          setHoverPreviewDiagram(cachedDiagram);
          setHoverPreviewStatus("ready");
        });
        return;
      }

      hoverRequestControllerRef.current?.abort();
      const controller = new AbortController();
      hoverRequestControllerRef.current = controller;
      setHoverPreviewDiagram(null);
      setHoverPreviewStatus("loading");

      try {
        const response = await fetch(
          `/api/diagram-preview?username=${encodeURIComponent(username)}&repo=${encodeURIComponent(repo)}`,
          {
            method: "GET",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`Failed to load preview (${response.status}).`);
        }

        const payload = (await response.json()) as { diagram?: string };
        const diagram = payload.diagram?.trim();
        if (!diagram) {
          throw new Error("Preview diagram missing.");
        }

        diagramPreviewCache.set(key, diagram);
        if (activeHoverPreviewKeyRef.current !== key) {
          return;
        }

        startTransition(() => {
          setHoverPreviewDiagram(diagram);
          setHoverPreviewStatus("ready");
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (activeHoverPreviewKeyRef.current !== key) {
          return;
        }
        setHoverPreviewDiagram(null);
        setHoverPreviewStatus("error");
      } finally {
        if (hoverRequestControllerRef.current === controller) {
          hoverRequestControllerRef.current = null;
        }
      }
    },
    [],
  );

  const handleRepoHoverStart = useCallback(
    (item: BrowseIndexEntry, pointerPosition: PointerPosition) => {
      if (!desktopHoverEnabled) {
        return;
      }

      preloadBrowseDiagramPreviewChart();
      clearHoverIntentTimeout();
      const key = `${item.username}/${item.repo}`;
      hoverIntentTimeoutRef.current = window.setTimeout(() => {
        activeHoverPreviewKeyRef.current = key;
        const initialPosition = getHoverPreviewPosition(
          pointerPosition.clientX,
          pointerPosition.clientY,
        );
        hoverPreviewPositionRef.current = initialPosition;
        setHoverPreview({
          key,
          repoLabel: key,
          ...initialPosition,
        });

        const cachedDiagram = diagramPreviewCache.get(key);
        if (cachedDiagram) {
          setHoverPreviewDiagram(cachedDiagram);
          setHoverPreviewStatus("ready");
          return;
        }

        setHoverPreviewDiagram(null);
        setHoverPreviewStatus("loading");
        void loadHoverPreview({
          key,
          repo: item.repo,
          username: item.username,
        });
      }, HOVER_PREVIEW_OPEN_DELAY_MS);
    },
    [clearHoverIntentTimeout, desktopHoverEnabled, loadHoverPreview],
  );

  const handleRepoHoverMove = useCallback(
    (item: BrowseIndexEntry, pointerPosition: PointerPosition) => {
      if (!desktopHoverEnabled) {
        return;
      }

      const key = `${item.username}/${item.repo}`;
      if (activeHoverPreviewKeyRef.current !== key) {
        return;
      }

      const nextPosition = getHoverPreviewPosition(
        pointerPosition.clientX,
        pointerPosition.clientY,
      );
      hoverPreviewPositionRef.current = nextPosition;

      if (hoverPreviewAnimationFrameRef.current !== null) {
        return;
      }

      hoverPreviewAnimationFrameRef.current = window.requestAnimationFrame(
        () => {
          hoverPreviewAnimationFrameRef.current = null;
          if (!hoverPreviewPositionRef.current) {
            return;
          }

          applyHoverPreviewPosition(hoverPreviewPositionRef.current);
        },
      );
    },
    [applyHoverPreviewPosition, desktopHoverEnabled],
  );

  return {
    closeHoverPreview,
    desktopHoverEnabled,
    handleRepoHoverMove,
    handleRepoHoverStart,
    hoverPreview,
    hoverPreviewDiagram,
    hoverPreviewElementRef,
    hoverPreviewStatus,
  };
}
