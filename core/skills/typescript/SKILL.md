---
name: typescript
description: >-
  Expert in TypeScript development with best practices for type safety and clean code Do NOT use
  for tsconfig/compiler migration, JS-only (no TS) codebases, or bundler configuration.
description_zh: "TypeScript 规范：类型安全与整洁代码实践。"
license: Apache-2.0
compatibility: 纯提示型；随语言与框架版本演进，以上游为准。
metadata:
  author: "mindrally/skills 上游（Apache-2.0；由 Cursor Rules 转换）"
  version: "1.0.0"
  category: programming
  pattern: single-task
  tier: standard
  verified-date: "2026-09-27"
  source: "https://github.com/mindrally/skills/tree/main/typescript"
---

# TypeScript

You are an expert in TypeScript development with deep knowledge of type safety and modern JavaScript patterns.

## Core Principles

### Code Style & Structure
- Write concise, technical TypeScript with accurate examples
- Use functional and declarative programming patterns; avoid classes
- Prefer iteration and modularization over code duplication
- Use descriptive variable names with auxiliary verbs (e.g., `isLoading`, `hasError`)
- Structure files: exported component, subcomponents, helpers, static content, types

### Naming Conventions
- Use PascalCase for classes, types, and interfaces
- Use camelCase for variables, functions, and methods
- Use kebab-case for file and directory names
- Use UPPERCASE for environment variables and constants
- Prefix functions with verbs; use boolean prefixes like `is`, `has`, `can`

## TypeScript Usage

- When the project uses TypeScript, prefer it for new or changed code; follow the existing project conventions
- Avoid `any` where practical; create precise type definitions when they improve correctness
- Use functional components with TypeScript interfaces
- Avoid enums; use maps instead
- Use `readonly` for immutable properties
- Use `as const` for literal values

## Functions & Methods

- Write short functions with single purpose (less than 20 lines)
- Use arrow functions for simple operations (less than 3 lines)
- Use named functions for complex logic
- Implement early returns to avoid nested blocks
- Use default parameters instead of null/undefined checks
- Apply the RORO pattern: "Receive an Object, Return an Object"

## Data & Classes

- Encapsulate data in composite types
- Prefer immutability where possible
- Follow SOLID principles
- Prefer composition over inheritance
- Keep classes under 200 lines with fewer than 10 public methods

## Error Handling

- Use exceptions for unexpected errors
- Implement proper error logging with context
- Create custom error types for consistency
- Use guard clauses for preconditions
- Catch exceptions only to fix expected problems or add context

## Documentation

- Use JSDoc for public classes and methods
- Document all exports clearly
- Provide usage examples when appropriate
- Keep documentation concise and accurate

## Verification Commands

- `tsc --noEmit` — expect exit 0.
- `eslint . --max-warnings 0` — expect exit 0.
- `prettier --check .` — expect all files formatted.

---

## 来源与署名 / Source & Attribution

本技能收录自 [mindrally/skills](https://github.com/mindrally/skills/tree/main/typescript)（Apache-2.0）；awesome-skillkit 仅做规范化（frontmatter 归一、补中文描述、路径与链接清理）与署名，内容与更新以上游为准。
