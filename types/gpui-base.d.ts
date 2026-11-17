import type { Context, Element } from "gpui-kit";

export function h_flex(): Element;
export function v_flex(): Element;
export interface InputState {
  value(): string;
  on(event: "change", callback: (event: unknown, cx: Context) => void): boolean;
}
export const InputState: { new: (options: { placeholder: string }) => InputState };
export const Input: { new: (state: InputState) => Element };
export interface EditorState {
  release(): void;
}
export const EditorState: {
  new: (options: {
    language: string;
    value: string;
    readonly: boolean;
    font_family: string;
    font_size: number;
  }) => EditorState;
};
export const Editor: { new: (state: EditorState) => Element };
export const Scrollbar: { vertical(id: string): Element };
