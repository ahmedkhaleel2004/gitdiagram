---
name: repo-architecture
description: Explain how a public GitHub repository is built using GitDiagram's architecture diagram. Use when the user asks how a GitHub repository or open-source project is structured or organized, wants an architecture or system diagram of a repo, or is starting work in an unfamiliar codebase hosted on GitHub.
---

# Explain a repository's architecture with GitDiagram

1. Work out the repository as `owner/repo`. Take it from a github.com URL the user gave, or, when working inside a local clone, from its `origin` remote. If the user only named a project, call `find_repository_diagrams` with the name and pick the match the user means; ask if several fit.
2. Call `get_repository_diagram` with `owner/repo`. It returns GitDiagram's written explanation, the main components with the paths they live in, how they connect, Mermaid source and the interactive diagram link. In ChatGPT the diagram also appears as an interactive view.
3. Answer the user's actual question from that result. Name components by their labels, cite their source paths, and give the interactive diagram link so they can explore it. The diagram is AI-generated from the repository's files: when the user needs certainty about a detail, check the code at the cited path.
4. If GitDiagram has no diagram yet, say so plainly and share the link from the result, which makes one on gitdiagram.com in about a minute. Don't describe an architecture you haven't read.
5. If the user wants something to watch or share, call `get_explainer_video` for the repository's narrated explainer video, when one exists.

GitDiagram only covers public GitHub repositories and is read-only: it never changes anything on GitHub.
