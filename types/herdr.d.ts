import type { Focus, Pane, Terminal } from "../src/contracts.js";

export function appHome(): string;
export function exec(
  command: string,
  args: string[],
  options: { timeout: number },
): Promise<{ code: number; stdout: string; stderr: string }>;
export function focused(): Focus | null;
export function panes(): Pane[];
export function terminals(): Terminal[];
export function layout(): unknown;
export function props(): unknown;
export function theme(): Record<string, string>;
export function settings(): { font_family: string };
export function openOverlay(options: {
  mod: string;
  kind: "dialog";
  width: number;
  height: number;
  props: unknown;
}): string;
export function closeOverlay(id: string): void;
