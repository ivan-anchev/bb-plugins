// Tests only, in Chrome (test-chrome.ts): draws the app's components on the page as bb's panel draws
// them, through the SDK's test host, with bb's Markdown drawn as bb draws it, by react-markdown with
// GFM, where the test host prints its source. why: where a text wraps, and what GFM finds a link in,
// are what the page is opened to see.
import type { MarkdownProps, PluginSdkApp } from "@get-bb/plugin-sdk/app";
import { installTestPluginRuntime, renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import type { ComponentType } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Draws `component` with `props` into the page, the host answering as `options` say. */
export function draw<Props extends object>(component: ComponentType<Props>, props: Props, options: RenderSlotOptions): void {
  installTestPluginRuntime();
  sdkRuntime().pluginSdkApp.Markdown = BbMarkdown;
  renderSlot({ component }, props, options);
}

// ------------------------------------------------------------------ layer 2

/** The SDK's runtime, which its test host installs on the page; `@get-bb/plugin-sdk/app` draws with what `pluginSdkApp` holds, and every install keeps the one object. */
const sdkRuntime = (): { pluginSdkApp: { -readonly [Name in keyof PluginSdkApp]: PluginSdkApp[Name] } } => Reflect.get(globalThis, "__bbPluginRuntime");

/** bb's Markdown as its chat draws it: GFM, in a box bb marks as its Markdown, with the class it is given. */
function BbMarkdown({ content, className }: MarkdownProps) {
  return (
    <div data-markdown-preview="" className={className}>
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  );
}
