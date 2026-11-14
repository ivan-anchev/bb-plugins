import type { ExperimentalCodeFenceRendererProps } from "@get-bb/plugin-sdk/app";
import { graphComponents } from "@/registry/default/graph-comark/graph-comark";
import { figureChildren } from "./figure-children";
import { readFigureSource } from "./figure-source";

/** `row` lays out nested blocks, which a single fence can't hold. */
export const FIGURE_LANGUAGES = Object.keys(graphComponents).filter((tag) => tag !== "row");

/**
 * One mdxcn figure from a fence whose language names it. While the reply
 * streams, bb's code block shows the source as it arrives; the figure takes
 * its place once the fence is complete, so its entrance animation runs once
 * over the whole data set.
 */
export function FigureFence({ code, language, status, Original }: ExperimentalCodeFenceRendererProps) {
  if (status === "streaming") return <Original />;

  const source = readFigureSource(code);
  if (!source.ok) {
    return (
      <>
        <Original />
        <p className="mt-1 text-xs text-destructive">mdxcn: {source.error}</p>
      </>
    );
  }

  const Figure = graphComponents[language];
  return (
    <div className="mdxcn my-5 px-2">
      <Figure {...source.props}>{figureChildren(language, source.body)}</Figure>
    </div>
  );
}
