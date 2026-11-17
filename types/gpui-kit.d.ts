// Hand-maintained contract for the native API this mod consumes, not a copy of
// generated runtime declarations. `npm run typecheck:herdr` checks the real host.
export interface Context {
  notify(): void;
  spawn(body: (cx: Context) => unknown): unknown;
  timer: { every(ms: number, body: (cx: Context) => void): unknown };
}

export class View {}

export interface Element {
  id(value: string): this;
  child(value: Element | string | number | boolean): this;
  children(values: (Element | string)[]): this;
  when(condition: boolean, body: (element: this) => Element): this;
  hover(body: (element: this) => Element): this;
  on_click(body: (event: unknown, cx: Context) => void): this;
  on_item_click(body: (key: string, cx: Context) => void): this;
  on_size_change(body: (size: { width: number; height: number }, cx: Context) => void): this;
  px(value: number): this;
  py(value: number): this;
  p(value: number): this;
  pl(value: number): this;
  w(value: number | `${number}%`): this;
  h(value: number): this;
  size(value: number): this;
  gap(value: number): this;
  min_w(value: number): this;
  min_h(value: number): this;
  max_h(value: number): this;
  text_size(value: number): this;
  text_color(value: `#${string}`): this;
  bg(value: `#${string}`): this;
  rounded(value: number): this;
  tooltip(value: string): this;
  size_full(): this;
  w_full(): this;
  h_full(): this;
  flex_1(): this;
  flex_none(): this;
  flex_wrap(): this;
  items_center(): this;
  items_end(): this;
  items_stretch(): this;
  justify_between(): this;
  cursor_pointer(): this;
  font_semibold(): this;
  truncate(): this;
  overflow_hidden(): this;
  overflow_y_scrollbar(): this;
  relative(): this;
  absolute(): this;
  inset_0(): this;
}

export function div(): Element;
export function svg(path: string): Element;
export function uniform_list(
  id: string,
  count: number,
  key: (index: number) => string,
  render: (range: { start: number; end: number }, cx: Context) => Element[],
): Element;
