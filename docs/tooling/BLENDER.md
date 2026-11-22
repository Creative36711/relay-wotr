# Blender in the Arena sandbox

The project pins **Blender/bpy 5.0.1** for CPython 3.11. The wheel SHA-256 is
stored in `tools/arena/bootstrap.sh`; installation stops if PyPI returns
unexpected bytes.

```bash
tools/arena/bootstrap.sh --art
/tmp/bpyenv/bin/bpy-python your_script.py
```

## Supported role

Use bpy for deterministic asset processing:

- mesh generation and modification;
- armatures and bones;
- keyframe animation;
- opening `.blend` sources;
- importing/exporting GLB;
- geometry validation and batch conversion.

The wheel links against desktop X11/GL libraries that Arena does not provide.
`tools/arena/bpy_stubs.py` generates minimal linker stubs so background geometry
and export operations can run. Those stubs are not a graphics implementation.
Do **not** depend on Blender Workbench, EEVEE, or Cycles rendering in CI.

## Rendering

Render previews and automated screenshots in the pinned Godot 4.7.2 build via
SwiftShader:

```bash
/tmp/godotbin/godot-swiftshader --path godot
```

The intended pipeline is:

```text
bpy: geometry + rig + animation -> GLB -> Godot: materials + lighting + render
```

This also catches the integration failures that matter to the game rather than
only proving that Blender can render its own source scene.

## Version upgrades

Do not casually change bpy. An upgrade requires all of the following in one
review:

1. update the pinned version and wheel SHA-256;
2. regenerate/test linker stubs;
3. open representative `.blend` files;
4. compare GLB structure and animation tracks;
5. run the Godot import and screenshot smoke tests.
