// One ```openui fence in an assistant message, drawn with OpenUI's stock
// components while it streams. A finished block with nothing to draw shows
// bb's own code block instead, so the message stays readable.
import type { ExperimentalCodeFenceRendererProps } from "@get-bb/plugin-sdk/app";
import { createParser, Renderer } from "@openuidev/react-lang";
import "@openuidev/react-ui/components.css";
import { type ComponentType, useMemo } from "react";
import { library } from "../library.ts";
import { BbThemeScope } from "./bb-theme-scope.tsx";
import { useBlockActions } from "./use-block-actions.ts";

const parser = createParser(library.toJSONSchema(), library.root);

export function UiBlock({ code, status, message, Original }: ExperimentalCodeFenceRendererProps) {
  const isStreaming = status === "streaming";
  const drawable = useMemo(() => isStreaming || parser.parse(code).root !== null, [code, isStreaming]);
  const onAction = useBlockActions(message.threadId);

  if (!drawable) return <UndrawableBlock Original={Original} />;
  return (
    <div className="my-2">
      <BbThemeScope>
        <Renderer library={library} response={code} isStreaming={isStreaming} onAction={onAction} />
      </BbThemeScope>
    </div>
  );
}

function UndrawableBlock({ Original }: { Original: ComponentType }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">This UI block couldn't be drawn, so here is its source.</p>
      <Original />
    </div>
  );
}
