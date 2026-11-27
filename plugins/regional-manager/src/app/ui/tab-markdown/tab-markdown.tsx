// Agent- and user-written text in an issue's tab, as the Markdown it is: its description and brief,
// its comments, decisions and research reports. bb's own renderer draws it, as it draws a chat
// message, so links open as they do in chat, and an issue link is the plugin's chat link
// (app/chat-links), which finds every link bb's Markdown renders. Raw HTML in it shows as the text it
// is written as, never an element (markdown-source.ts). Its size is the text around it (tab-markdown.css).
import "./tab-markdown.css";
import { Markdown } from "@get-bb/plugin-sdk/app";
import { useMemo } from "react";
import { inertHtml } from "./markdown-source.ts";

export function TabMarkdown({ text }: { text: string }) {
  // why memoized: a report runs to 20,000 characters, and the feed draws again as its issue changes.
  const content = useMemo(() => inertHtml(text), [text]);
  return <Markdown content={content} className="rmi-markdown" />;
}
