import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { project } from "../model/fixtures.ts";

// A view's options menu, mounted as bb mounts the sidebar.

const { ViewMenu } = await import("./view-menu.tsx");

afterEach(cleanup);

async function open(projects: readonly PluginSidebarProject[], chosen: PluginSidebarProject | null = null) {
  const slot = renderSlot({ component: ViewMenu }, { view: "managers", projects, chosen, onChoose: () => {}, compact: false, onCompact: () => {} });
  const button = slot.getByRole("button");
  const name = button.getAttribute("aria-label");
  await act(async () => fireEvent.keyDown(button, { key: "Enter" }));
  const items = Array.from(document.querySelectorAll<HTMLElement>("[role=menuitemcheckbox], [role=menuitemradio]"), (item) => item.querySelector(".as-menu-label")?.textContent);
  return { name, items };
}

test("with no projects to choose from, the menu holds Compact alone", async () => {
  assert.deepEqual(await open([]), { name: "Managers options", items: ["Compact"] });
});

test("with projects, Compact then All projects and each of them; the button names the view and its filter", async () => {
  const projects = [project("prj_a", "bb-plugins"), project("prj_b", "skills")];
  assert.deepEqual(await open(projects, projects[1]), { name: "Managers options, filtered to skills", items: ["Compact", "All projects", "bb-plugins", "skills"] });
});
