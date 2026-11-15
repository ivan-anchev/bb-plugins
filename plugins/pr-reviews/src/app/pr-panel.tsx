import { experimental_Icon as Icon, useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { PrPage } from "./page/pr-page.tsx";
import { PANEL_PATH, parseRoute } from "./routes.ts";
import { PrSidebar } from "./sidebar/pr-sidebar.tsx";
import { Button } from "./ui/button.tsx";

export function PrPanel(props: PluginNavPanelProps) {
  const showingPr = parseRoute(props.subPath).kind === "pr";
  const navigate = useBbNavigate();

  return (
    <div className="@container flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1">
        <nav
          aria-label="Pull requests"
          className={`${showingPr ? "hidden @3xl:flex" : "flex"} min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-background py-3 @3xl:w-72 @3xl:flex-none @3xl:border-r @3xl:border-border`}
        >
          <PrSidebar {...props} />
        </nav>
        <div className={`${showingPr ? "flex" : "hidden @3xl:flex"} min-h-0 min-w-0 flex-1 flex-col`}>
          {showingPr && (
            <div className="shrink-0 border-b border-border px-3 py-1 @3xl:hidden">
              <Button variant="ghost" size="sm" onClick={() => navigate.toPluginPanel(PANEL_PATH)}>
                <Icon name="ArrowLeft" className="size-4" aria-hidden />
                Pull requests
              </Button>
            </div>
          )}
          <PrPage {...props} />
        </div>
      </div>
    </div>
  );
}
