# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Excalidraw is a virtual hand-drawn style whiteboard — a React component library with a full web app. This is a fork hosted on EC2 with custom features. Monorepo using Yarn 1.22.22 workspaces. Requires Node >= 18.

## Monorepo Structure

- **`packages/excalidraw/`** — Main React component library (`@excalidraw/excalidraw`), published to npm
- **`packages/common/`** — Shared utilities and constants (`@excalidraw/common`)
- **`packages/element/`** — Element logic and operations (`@excalidraw/element`)
- **`packages/math/`** — Geometry primitives: point, line, curve, polygon, etc. (`@excalidraw/math`)
- **`packages/utils/`** — File handling and encoding (`@excalidraw/utils`)
- **`excalidraw-app/`** — Full web app (the deployed application), uses Vite
- **`examples/`** — Integration examples (NextJS, browser script)

## Commands

```bash
# Development
yarn start                  # Start dev server (port 3000, configurable via VITE_APP_PORT)

# Testing
yarn test:app               # Run tests (vitest, jsdom environment)
yarn test:update             # Run tests with snapshot updates
yarn test:typecheck          # TypeScript type checking (tsc)
yarn test:all                # All checks (lint + types + tests)

# Linting & Formatting
yarn test:code               # ESLint (zero warnings allowed)
yarn test:other              # Prettier check
yarn fix                     # Auto-fix all lint and formatting issues
yarn fix:code                # ESLint auto-fix only
yarn fix:other               # Prettier auto-fix only

# Building
yarn build:app               # Build the web app (output: excalidraw-app/build/)
yarn build:packages          # Build all library packages
yarn build:excalidraw        # Build just the main package
```

To run a single test file: `yarn vitest run path/to/test.file`
To run tests matching a pattern: `yarn vitest run -t "test name pattern"`

## Architecture

### State Management
Jotai atoms via `editorJotaiStore`. The main component wraps in `EditorJotaiProvider`. Key hooks: `useExcalidrawAPI`, `useAppStateValue`, `useOnAppStateChange`.

### Action System
`packages/excalidraw/actions/` contains ~46 action handlers (align, clipboard, delete, duplicate, export, flip, group, history, zindex, etc.) registered through `manager.tsx` and `register.ts`.

### Rendering Pipeline
Dual rendering: Canvas (interactive + static scenes) and SVG (export). Hand-drawn effects via `roughjs`. Freehand drawing via `perfect-freehand`.

### Collaboration
Real-time via Socket.io, persistence via Firebase. End-to-end encryption. Config in `.env.*` files.

### Build System
- **Packages**: esbuild with SASS plugin, outputs `dist/dev/` and `dist/prod/`
- **App**: Vite with React plugin, PWA (Workbox), SVG-to-React, locale code-splitting
- **Path aliases**: All `@excalidraw/*` packages aliased to their `src/` directories (see `tsconfig.json`)

### Key Patterns
- TypeScript strict mode throughout
- Functional React components with hooks, CSS modules for styling
- Prefer immutable data (`const`, `readonly`)
- Prefer performance: trade RAM for fewer CPU cycles, prefer implementations without allocation
- Use `Point` type from `packages/math/src/types.ts` instead of `{ x, y }`
- Import ordering: builtin > external > internal > parent > sibling > index > object > type
- Type-only imports enforced (`import type` when importing only types)
- No barrel imports within `packages/excalidraw`
- No direct jotai imports (use the project's jotai wrapper)

## Coding Conventions

- PascalCase for components, interfaces, type aliases
- camelCase for variables, functions, methods
- ALL_CAPS for constants
- Use optional chaining (`?.`) and nullish coalescing (`??`)

## Environment

Key env vars (in `.env.development` / `.env.production`):
- `VITE_APP_BACKEND_V2_GET_URL` — JSON storage API
- `VITE_APP_WS_SERVER_URL` — WebSocket collaboration server
- `VITE_APP_AI_BACKEND` — AI backend endpoint
- `VITE_APP_FIREBASE_CONFIG` — Firebase project config
