"use client"

import type { ComponentType } from "react"

import { Graph, GraphBody } from "@/registry/default/graph-frame/graph-frame"
import type { GraphAdapter } from "@/registry/default/graph-comark/adapters"
import { coerceProps } from "@/registry/default/graph-comark/coerce"

function PendingGraph({ title }: { title?: string }) {
  return (
    <Graph title={title}>
      <GraphBody className="flex items-center justify-center py-14">
        <span className="font-mono text-sm text-graph-frame select-none">
          · · ·
        </span>
      </GraphBody>
    </Graph>
  )
}

function isPresent(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === "string") return value.trim() !== ""
  return true
}

function propsKey(props: Record<string, unknown>): string | undefined {
  try {
    const parts: string[] = []
    for (const [key, value] of Object.entries(props)) {
      if (key === "children") continue
      parts.push(
        `${key}=${typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)}`
      )
    }
    return parts.join("|")
  } catch {
    return undefined
  }
}

export function fromMarkdown<P extends Record<string, unknown>>(
  Component: ComponentType<P>,
  { numeric = [], required = [] }: GraphAdapter = {}
) {
  function MarkdownGraph(raw: Record<string, unknown>) {
    const props = coerceProps<P>(raw, numeric)

    const written = isPresent(props.children)
    if (!written && !required.every((key) => isPresent(props[key]))) {
      return <PendingGraph title={props.title as string | undefined} />
    }

    return <Component key={propsKey(props)} {...props} />
  }

  MarkdownGraph.displayName = `FromMarkdown(${
    Component.displayName ?? Component.name ?? "Graph"
  })`

  return MarkdownGraph as ComponentType<Record<string, unknown>>
}
