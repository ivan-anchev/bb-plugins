// Gives OpenUI's stock theme bb's light/dark mode, scoped to one UI block so
// OpenUI's variables never land on bb's <body>.
import { experimental_useCodeTheme } from "@get-bb/plugin-sdk/app";
import { ThemeProvider } from "@openuidev/react-ui";
import type { ReactNode } from "react";

const SCOPE_CLASS = "generative-ui-block";

export function BbThemeScope({ children }: { children: ReactNode }) {
  const { mode } = experimental_useCodeTheme();
  return (
    <div className={SCOPE_CLASS}>
      <ThemeProvider mode={mode} cssSelector={`.${SCOPE_CLASS}`}>
        {children}
      </ThemeProvider>
    </div>
  );
}
