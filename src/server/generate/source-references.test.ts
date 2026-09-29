import { describe, expect, it } from "vitest";
import type { RepositoryPathType } from "./github";
import {
  createReferenceResolver,
  MAX_REFERENCES_PER_FILE,
} from "./source-references";

function tree(files: string[], folders: string[] = []) {
  const types = new Map<string, RepositoryPathType>();
  for (const folder of folders) types.set(folder, "tree");
  for (const file of files) {
    const parts = file.split("/");
    for (let index = 1; index < parts.length; index++)
      types.set(parts.slice(0, index).join("/"), "tree");
    types.set(file, "blob");
  }
  return createReferenceResolver(types);
}

describe("source references", () => {
  it("resolves JavaScript relative, extensionless, index, alias and ESM .js imports", () => {
    const resolve = tree([
      "src/app/page.tsx",
      "src/components/Editor.tsx",
      "src/components/index.ts",
      "src/lib/store.ts",
      "src/server/db.ts",
      "src/styles.css",
    ]);
    expect(
      resolve(
        "src/app/page.tsx",
        [
          'import { Editor } from "../components/Editor";',
          'import * as all from "../components";',
          'import { store } from "~/lib/store";',
          'export { db } from "@/server/db.js";',
          'import "../styles.css";',
          'import React from "react";',
          'const lazy = () => import("../lib/store");',
        ].join("\n"),
      ),
    ).toEqual([
      "src/components/Editor.tsx",
      "src/components/index.ts",
      "src/lib/store.ts",
      "src/server/db.ts",
      "src/styles.css",
    ]);
  });

  it("maps scoped workspace packages to their folder but never unscoped names", () => {
    const resolve = tree(
      ["packages/next/src/server.ts", "packages/server/src/index.ts"],
      ["packages/next", "packages/server"],
    );
    expect(
      resolve(
        "packages/next/src/server.ts",
        'import { initTRPC } from "@trpc/server";\nimport { headers } from "next/headers";',
      ),
    ).toEqual(["packages/server"]);
  });

  it("resolves Python relative, absolute and submodule imports", () => {
    const resolve = tree([
      "httpx/__init__.py",
      "httpx/_client.py",
      "httpx/_models.py",
      "httpx/_transports/__init__.py",
      "httpx/_transports/default.py",
      "src/pkg/service.py",
    ]);
    expect(
      resolve(
        "httpx/_client.py",
        [
          "from ._models import Request, Response",
          "from ._transports import default",
          "from ._transports.default import (\n    HTTPTransport,\n)",
          "import pkg.service",
          "import json",
        ].join("\n"),
      ),
    ).toEqual([
      "httpx/_models.py",
      "httpx/_transports/default.py",
      "src/pkg/service.py",
    ]);
  });

  it("resolves Rust crate, super, self, brace groups and mod declarations", () => {
    const resolve = tree([
      "src/main.rs",
      "src/network/mod.rs",
      "src/network/proxy.rs",
      "src/network/canonical_url.rs",
      "src/network/cors.rs",
      "src/token/auth.rs",
      "src/config/config.rs",
    ]);
    expect(
      resolve(
        "src/network/proxy.rs",
        [
          "use crate::token::auth::validate;",
          "use crate::config::{config::load, self};",
          "use super::canonical_url::canonicalize;",
          "let x = crate::network::cors::apply(req);",
        ].join("\n"),
      ).sort(),
    ).toEqual([
      "src/config/config.rs",
      "src/network/canonical_url.rs",
      "src/network/cors.rs",
      "src/token/auth.rs",
    ]);
    expect(
      resolve("src/network/mod.rs", "pub mod proxy;\nmod cors;\n"),
    ).toEqual(["src/network/proxy.rs", "src/network/cors.rs"]);
  });

  it("resolves Go module imports to package folders, never the standard library", () => {
    const resolve = tree(
      ["cmd/api/main.go", "internal/store/store.go", "http/server.go"],
      ["internal/store", "http"],
    );
    expect(
      resolve(
        "cmd/api/main.go",
        'import (\n  "net/http"\n  "github.com/acme/app/internal/store"\n)\n',
      ),
    ).toEqual(["internal/store"]);
  });

  it("names class-per-file types only when the name is unique, ignoring comments", () => {
    const resolve = tree([
      "Program.cs",
      "SipBridge.cs",
      "SipVoiceAgent.cs",
      "OfficeBridge.cs",
      "Tui.cs",
      "e2e/Smoke/Program.cs",
    ]);
    expect(
      resolve(
        "SipBridge.cs",
        [
          "// OfficeBridge is not used here",
          "/* Program shows it */",
          "var agent = new SipVoiceAgent(config);",
          "Tui.Refresh();",
          "Program.Main();",
        ].join("\n"),
      ),
    ).toEqual(["SipVoiceAgent.cs", "Tui.cs"]);
  });

  it("resolves Java imports and same-package type names", () => {
    const resolve = tree([
      "src/main/java/com/acme/Api.java",
      "src/main/java/com/acme/store/Repo.java",
      "src/main/java/com/acme/Worker.java",
    ]);
    expect(
      resolve(
        "src/main/java/com/acme/Api.java",
        "import com.acme.store.Repo;\nclass Api { Worker worker; }",
      ),
    ).toEqual([
      "src/main/java/com/acme/store/Repo.java",
      "src/main/java/com/acme/Worker.java",
    ]);
  });

  it("resolves C includes relative to the file or by suffix", () => {
    const resolve = tree([
      "src/net/socket.c",
      "src/net/socket.h",
      "include/util.h",
    ]);
    expect(
      resolve(
        "src/net/socket.c",
        '#include "socket.h"\n#include "util.h"\n#include <stdio.h>',
      ),
    ).toEqual(["src/net/socket.h", "include/util.h"]);
  });

  it("never lists the file itself, paths outside the repository, or too many files", () => {
    const files = Array.from({ length: 60 }, (_, index) => `src/m${index}.ts`);
    const resolve = tree(["src/main.ts", ...files]);
    const text = [
      'import "./main";',
      'import "../../outside";',
      ...files.map((file) => `import "./${file.slice(4, -3)}";`),
    ].join("\n");
    const references = resolve("src/main.ts", text);
    expect(references).not.toContain("src/main.ts");
    expect(references).toHaveLength(MAX_REFERENCES_PER_FILE);
  });
});
