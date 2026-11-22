# Arena toolchain

Arena sandboxes can be recreated, have no GPU, and cannot reach GitHub release
asset hosts. WOTR Remaster therefore keeps only small, reproducible bootstrap
logic plus a checksum-pinned Godot/SwiftShader bundle in Git.

## Profiles

```bash
tools/arena/bootstrap.sh --runtime  # CMake, Ninja, Godot, SwiftShader
tools/arena/bootstrap.sh --art      # Godot, SwiftShader, Pillow, bpy
tools/arena/bootstrap.sh            # both profiles
tools/arena/bootstrap.sh --check    # report only; do not install
```

Temporary dependencies go under `/tmp`; source and pinned vendor archives stay
inside the repository. Re-running a profile is idempotent.

## Godot without a GPU

`/tmp/godotbin/godot-swiftshader` is the supported launcher. It sets
`VK_ICD_FILENAMES` and `LD_LIBRARY_PATH` before running the pinned Godot 4.7.2
binary. Do not use `--headless` for visual screenshots: a headless display
server does not produce the frame we need to inspect. SwiftShader renders
Vulkan offscreen on the CPU.

```bash
/tmp/godotbin/godot-swiftshader --path godot
```

## C++ build profiles

```bash
tools/arena/build_engine.sh             # runnable GDExtension, tests disabled
tools/arena/build_engine.sh --quick     # smallest C++ edit/compile loop
tools/arena/build_engine.sh --core      # core static library only
tools/arena/build_engine.sh --tests     # extension and C++ tests
tools/arena/build_engine.sh --check     # inspect existing products
tools/arena/build_engine.sh --clean     # clean runnable build
tools/arena/smoke_godot.sh              # extension/script load, no retail needed
```

The smoke script copies the small Godot project to `/tmp` and performs the
required import there; without generated `.godot/extension_list.cfg` Godot does
not load the GDExtension. Isolating the import also prevents generated
`.uid`/`.import` sidecars from dirtying the checkout. The source-only test
accepts the intentional "no game folders chosen" stop but rejects an unloaded
extension or GDScript parse error.

The script resolves the exact `godot-cpp` gitlink from the checked-out
OpenBFME commit and downloads that revision through `codeload.github.com` when
the submodule is empty. This keeps future nightly merges reproducible.

## Art tools

Blender is installed as the pinned `bpy==5.0.1` CPython module. In Arena it is
used for mesh, armature, animation, `.blend`, and GLB work; final rendering is
performed by Godot/SwiftShader.

```bash
/tmp/bpyenv/bin/bpy-python script.py
/tmp/mediaenv/bin/cutout-chromakey input.png output.png --crop
```

See `BLENDER.md` and `ART-PIPELINE.md` in this directory.

## Retail restoration and resets

Retail BIG data is never loaded into model context and is never committed. Use
`retail_big_transfer.py ingest`: each local 95-MiB volume is authenticated,
written with an atomic checkpoint, and optionally deleted before the next is
fetched. This keeps RAM use bounded by the 8-MiB I/O buffer and disk overhead
bounded by one transfer volume.

A full sandbox replacement can still discard `.retail/`; Google Drive remains
the persistent source. Expensive runtime checks should therefore be grouped
into one validation session, while normal C++/GDScript development runs without
retail data.
