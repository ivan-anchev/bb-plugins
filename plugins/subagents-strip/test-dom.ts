import { JSDOM } from "jsdom";

const { window } = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
Object.defineProperty(globalThis, "document", { configurable: true, value: window.document });
