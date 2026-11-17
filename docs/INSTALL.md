# Install and add to a layout

## Recommended

Run this in your agent:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/no-complect/herdr-context-facey
```

The agent should read the recipe and runtime files, preserve your configuration,
and check the mod after adding it. It should ask before replacing an existing
shortcut. This repository contains no replacement layout.

## Manual installation

Copy `mods/herdr-context-facey/` into your Herdr app home's `mods/` directory,
usually `~/.config/herdr-app/mods/`. Review an existing destination before
updating it. Herdr supplies its own generated editor type files.
Copy the whole folder, including `reader/`; the JavaScript client and Python reader
share a versioned protocol and should be updated together.
The folder includes compiled JavaScript, including Herdr's required `main.js`.
TypeScript sources live in `src/` for development; do not rename installed mod
files to `.ts`. No TypeScript compiler or Node installation is needed to use the mod.

When replacing an older inspector copy such as `tuuxic-context`, also update the
existing Context block's `content.mod` to `herdr-context-facey` and point its
dialog shortcut to `mod.open:herdr-context-facey`. Installing the new folder alone
does not change which mod an existing layout displays. Preserve your panel's
layout ID and its show/hide controls.

Check and open the installed mod:

```sh
herdr-app check ~/.config/herdr-app/mods/herdr-context-facey
herdr-app do mod.open --name herdr-context-facey
```

Running `mod.open` again closes the dialog; Escape or Close also dismisses it.
The root `keys.json` is an optional snippet mapping macOS **Ctrl + Command + X**
and **Alt + Command + X** to that action. The dialog inherits the current panel's
session selection when a panel is present. Merge the bindings into a suitable section of your keys file;
do not replace the file. More specific terminal, mod, and layout bindings can
override `global`. Choose an appropriate shortcut on other platforms.

## Embedded panel

Add this block to an appropriate split or stack in your personal layout:

```json
{
  "id": "my-context-panel",
  "type": "block",
  "content": { "mod": "herdr-context-facey" }
}
```

The mod recognizes hidden ancestors and inactive stack children, using any node
names. For multiple copies, pass `"props": { "blockId": "my-context-panel" }`
inside `content` to identify a particular copy.

Your layout supplies a button or shortcut for the embedded panel. Typically it
selects the Context stack child and shows its parent; if that child is already
visible, it hides the parent instead. The supplied shortcut toggles a dialog.
Screenshots show Tuuxic as one example integration; it is not bundled or required.

Herdr's own layouts and mods should be cloned before structural edits. Follow
the instructions in your app home's `AGENTS.md`, which match your installed
Herdr version.

## Uninstall

Remove the layout block and optional key binding you added, then remove the
installed `mods/herdr-context-facey/` folder. Agent histories are untouched.
