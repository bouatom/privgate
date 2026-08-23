import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const nodeBound =
  "Client Components must import types from @/lib/models. This module uses Node builtins and cannot be bundled for the browser.";

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["src/app/**/*-client.tsx", "src/app/**/console-shell.tsx", "src/app/**/session-context.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/lib/db", message: nodeBound },
            { name: "@/lib/auth", message: nodeBound },
            { name: "@/lib/portal", message: nodeBound },
            { name: "@/lib/present", message: nodeBound },
            { name: "@/lib/bootstrap", message: nodeBound },
            { name: "@/lib/passwords", message: nodeBound },
            { name: "@/lib/crypto-secret", message: nodeBound },
            { name: "@/lib/evaluate", message: nodeBound },
            { name: "@/lib/signing", message: nodeBound },
            { name: "@/lib/device-auth", message: nodeBound },
            { name: "@/lib/entra", message: nodeBound },
            { name: "@/lib/listen", message: nodeBound },
            { name: "@/lib/http", message: nodeBound },
            { name: "@/lib/setup-state", message: nodeBound },
          ],
        },
      ],
    },
  },
];
