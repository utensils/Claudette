{
  description = "Claudette — cross-platform desktop orchestrator for parallel Claude Code agents";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";

    devshell.url = "github:numtide/devshell";
    devshell.inputs.nixpkgs.follows = "nixpkgs";

    treefmt-nix.url = "github:numtide/treefmt-nix";
    treefmt-nix.inputs.nixpkgs.follows = "nixpkgs";

    fenix.url = "github:nix-community/fenix";
    fenix.inputs.nixpkgs.follows = "nixpkgs";

    crane.url = "github:ipetkov/crane";
  };

  outputs =
    inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [
        inputs.devshell.flakeModule
        inputs.treefmt-nix.flakeModule
      ];

      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      perSystem =
        {
          pkgs,
          system,
          lib,
          ...
        }:
        let
          fenixPkgs = inputs.fenix.packages.${system};
          rustToolchain = fenixPkgs.combine [
            fenixPkgs.latest.cargo
            fenixPkgs.latest.clippy
            fenixPkgs.latest.llvm-tools-preview
            fenixPkgs.latest.rust-src
            fenixPkgs.latest.rustc
            fenixPkgs.latest.rustfmt
            # Windows MSVC cross-compile targets (consumed via cargo-xwin in
            # the devshell). aarch64 is the priority per project plan;
            # x86_64 included so both Windows architectures are available.
            # rust-std ships the Windows stdlib binaries; the MS CRT and
            # Windows SDK headers are fetched on demand by cargo-xwin.
            fenixPkgs.targets.aarch64-pc-windows-msvc.latest.rust-std
            fenixPkgs.targets.x86_64-pc-windows-msvc.latest.rust-std
          ];

          craneLib = (inputs.crane.mkLib pkgs).overrideToolchain rustToolchain;

          # Version from workspace Cargo.toml — single source of truth
          crateInfo = craneLib.crateNameFromCargoToml { cargoToml = ./Cargo.toml; };
          inherit (crateInfo) version;

          commonMeta = {
            homepage = "https://github.com/utensils/Claudette";
            license = lib.licenses.mit;
            platforms = [
              "x86_64-linux"
              "aarch64-linux"
              "aarch64-darwin"
            ];
          };

          # Frontend: FOD with network access for bun install + vite build.
          # Update the hash when src/ui/bun.lock or package.json change:
          #   nix build .#frontend 2>&1 | grep 'got:' | awk '{print $2}'
          frontend = pkgs.stdenvNoCC.mkDerivation {
            pname = "claudette-frontend";
            inherit version;
            src = ./src/ui;

            # nodejs is only needed on Linux to resolve the
            # `#!/usr/bin/env node` shebangs that bun installs into
            # node_modules — the Nix build sandbox on Linux has no
            # /usr/bin/env, so patchShebangs rewrites them to an absolute
            # store path. macOS's sandbox has /usr/bin/env and the original
            # FOD hash was computed without patching, so keep the old code
            # path there to avoid a pointless hash churn.
            nativeBuildInputs = [
              pkgs.bun
            ]
            ++ lib.optionals pkgs.stdenv.isLinux [
              pkgs.nodejs
            ];

            outputHashMode = "recursive";
            outputHashAlgo = "sha256";
            # FOD hashes differ across platforms because vite/tsc can embed
            # platform-specific paths into its sourcemap output, and on
            # Linux we additionally patchShebangs the node_modules tree.
            # Update the relevant branch when src/ui/bun.lock or
            # package.json change:
            #   nix build .#frontend 2>&1 | grep 'got:' | awk '{print $2}'
            outputHash =
              if pkgs.stdenv.isDarwin then
                "sha256-4DTkNSdBEuOH4cwx9arUglGaDUp87gnbOflAjDBYVEM="
              else
                "sha256-TP3Ck8BOXAZRMo7YPVGvxe9ULewNhdVsUU9x/bpjJL4=";

            buildPhase = ''
              export HOME=$TMPDIR
              bun install --frozen-lockfile
            ''
            + lib.optionalString pkgs.stdenv.isLinux ''
              # Patch the real binary files, not the .bin/ symlinks —
              # patchShebangs doesn't follow symlinks into unrelated paths,
              # and the actual tsc/vite binaries live under their package
              # directories (e.g. node_modules/typescript/bin/tsc).
              patchShebangs node_modules
            ''
            + ''
              bun run build
            '';

            installPhase = ''
              cp -r dist $out
            '';
          };

          # Cargo-only source: Cargo.toml, Cargo.lock, and *.rs files.
          # Used by buildDepsOnly so UI/asset changes don't rebuild deps.
          cargoSrc = craneLib.cleanCargoSource ./.;

          # Full source: Cargo files + src-tauri config + assets (logo for
          # tauri-codegen) + plugins (seeded into the binary via include_str!
          # from src/scm_provider/seed.rs).
          src = lib.cleanSourceWith {
            src = ./.;
            filter =
              path: type:
              (craneLib.filterCargoSources path type)
              || (builtins.match ".*src-tauri/.*" path != null)
              || (builtins.match ".*assets/.*" path != null)
              || (builtins.match ".*plugins/.*" path != null);
          };

          # Platform-specific build dependencies
          darwinBuildInputs = lib.optionals pkgs.stdenv.isDarwin [
            pkgs.apple-sdk_15
            pkgs.libiconv
          ];

          # Wrapper around `clang` that rewrites the MSVC-style `/imsvc`
          # include flag to the GNU-driver-compatible `-isystem` form.
          #
          # cargo-xwin's default (and correct-for-STL) mode is clang-cl: it
          # injects `/imsvc <path>` pairs into CFLAGS_<target> so that clang-cl
          # sees the MSVC CRT + SDK + C++ STL under xwin/crt/include (which
          # actually contains <iterator>, <vector>, ... — the alternative
          # "sysroot" mode ships a sysroot whose include/c++/stl/ directory
          # is empty on aarch64, so clang-cl mode is the only workable one).
          #
          # The snag: `ring`'s build script compiles Windows ARM64 `.S`
          # assembly by invoking `clang` directly (not clang-cl, because
          # clang-cl doesn't parse GAS syntax). The GNU-driver `clang` then
          # rejects `/imsvc` (treated as a filename) and also rejects
          # `-imsvc` (clang-cl-only spelling). The only spelling accepted by
          # both drivers is `-isystem`, which carries the same semantics we
          # need here (mark the directory as a system header root, suppress
          # diagnostics from headers within it).
          #
          # Wrapping `clang` specifically (not clang-cl, not clang++) is
          # sufficient because that is the exact binary ring shells out to
          # for the .S pregenerated files.
          clangXwinShim = pkgs.writeShellScriptBin "clang" ''
            args=()
            for arg in "$@"; do
              case "$arg" in
                /imsvc) args+=("-isystem") ;;
                *) args+=("$arg") ;;
              esac
            done
            exec ${pkgs.llvmPackages.clang-unwrapped}/bin/clang "''${args[@]}"
          '';

          # Linux native deps for webkit + GTK stack.
          # NOTE: cairo / pango / harfbuzz / atk / gdk-pixbuf are propagated by
          # gtk3, so nixpkgs' pkg-config setup hook picks them up automatically
          # under `pkgs.mkShell` and `stdenv.mkDerivation`. We still list them
          # here explicitly because `numtide/devshell` does not run that hook,
          # and the devshell's PKG_CONFIG_PATH is built from this list below.
          # Listing them in the package build too is harmless (they're already
          # propagated) and keeps one source of truth for Linux deps.
          linuxBuildInputs = lib.optionals pkgs.stdenv.isLinux [
            pkgs.webkitgtk_4_1
            pkgs.gtk3
            pkgs.cairo
            pkgs.pango
            pkgs.harfbuzz
            pkgs.atk
            pkgs.gdk-pixbuf
            pkgs.libsoup_3
            pkgs.glib
            pkgs.glib-networking
            pkgs.openssl
            pkgs.zlib
            pkgs.libayatana-appindicator
            # webkit2gtk delegates <video>/<audio> rendering to GStreamer.
            # Without gst-plugins-base the dev log fills with
            # `GStreamer element appsink not found. Please install it.`
            # and any future media element fails silently.
            pkgs.gst_all_1.gstreamer
            pkgs.gst_all_1.gst-plugins-base
            # Desktop-wide GSettings schemas (org.gtk.Settings.FileChooser,
            # org.gnome.desktop.interface, etc.). Without this package GTK's
            # file chooser aborts the process on open with
            # `GLib-GIO-ERROR: No GSettings schemas are installed`.
            pkgs.gsettings-desktop-schemas
          ];

          commonCraneArgs = {
            inherit src;

            strictDeps = true;

            nativeBuildInputs = [
              pkgs.pkg-config
              pkgs.cmake
              pkgs.perl
            ]
            ++ lib.optionals pkgs.stdenv.isLinux [
              pkgs.wrapGAppsHook4
            ];

            buildInputs = darwinBuildInputs ++ linuxBuildInputs;

            # Sane deployment target — nixpkgs-unstable stdenv defaults to the
            # SDK version (26.x) which aws-lc-sys rejects.
            env = lib.optionalAttrs pkgs.stdenv.isDarwin {
              MACOSX_DEPLOYMENT_TARGET = "11.0";
            };
          };

          # Cargo deps — cached separately from source changes.
          # Uses cargoSrc (Cargo files + *.rs only) so UI/asset edits
          # don't invalidate the dependency cache.
          cargoArtifacts = craneLib.buildDepsOnly (
            commonCraneArgs
            // {
              src = cargoSrc;

              # Tauri build.rs needs a frontend dir to exist
              preBuild = ''
                mkdir -p src/ui/dist
                echo '<html></html>' > src/ui/dist/index.html
              '';
            }
          );

          # Tauri desktop app
          claudette = craneLib.buildPackage (
            commonCraneArgs
            // {
              inherit cargoArtifacts;
              cargoExtraArgs = "-p claudette-tauri";

              preBuild = ''
                mkdir -p src/ui/dist
                cp -r ${frontend}/* src/ui/dist/
              '';

              # claudette-tauri's pty/usage tests spawn real shells and hit
              # the network — neither works in the Nix sandbox. CI (GitHub
              # Actions) runs `cargo test -p claudette -p claudette-server`
              # against a regular Linux runner to cover the logic under
              # test; skip tests here to keep `nix build` reproducible.
              doCheck = false;

              meta = commonMeta // {
                description = "Cross-platform desktop orchestrator for parallel Claude Code agents";
                mainProgram = "claudette";
              };
            }
          );

          # Headless server binary — version from src-server/Cargo.toml
          serverInfo = craneLib.crateNameFromCargoToml { cargoToml = ./src-server/Cargo.toml; };

          claudette-server = craneLib.buildPackage (
            commonCraneArgs
            // {
              inherit cargoArtifacts;
              pname = serverInfo.pname;
              version = serverInfo.version;
              cargoExtraArgs = "-p claudette-server";

              meta = commonMeta // {
                description = "Headless Claudette backend for remote access";
                mainProgram = "claudette-server";
              };
            }
          );
        in
        {
          # -- Packages ----------------------------------------------------------
          packages = {
            default = claudette;
            inherit claudette claudette-server frontend;
          };

          # -- Checks ------------------------------------------------------------
          checks = {
            inherit claudette claudette-server;

            clippy = craneLib.cargoClippy (
              commonCraneArgs
              // {
                inherit cargoArtifacts;
                cargoClippyExtraArgs = "--workspace --all-targets -- -D warnings";

                preBuild = ''
                  mkdir -p src/ui/dist
                  echo '<html></html>' > src/ui/dist/index.html
                '';
              }
            );

            fmt = craneLib.cargoFmt { inherit src; };
          };

          # -- Dev shell ---------------------------------------------------------
          devshells.default = {
            name = "claudette";

            packages = [
              rustToolchain
              pkgs.bun
              pkgs.cargo-tauri
              pkgs.pkg-config
              pkgs.cmake
              pkgs.perl
              pkgs.cargo-llvm-cov
              # Windows cross-compile toolchain. cargo-xwin shells out to
              # clang-cl (the MSVC-compatible driver) and llvm-lib / llvm-ar
              # as the archiver; rust-lld is bundled with the fenix rustc
              # above, so no separate lld package is needed.
              #
              # clangXwinShim wraps plain `clang` (see its definition above)
              # to rewrite `/imsvc` → `-isystem`; `lib.hiPrio` lets it win the
              # buildEnv symlink conflict over clang-unwrapped's own
              # `bin/clang`, while clang-unwrapped's other binaries
              # (clang-cl, clang++, ...) pass through unchanged.
              #
              # We intentionally use clang-unwrapped rather than
              # llvmPackages.clang: the cc-wrapper variant only exposes the
              # `clang` / `clang++` entry points and hides the `clang-cl`
              # symlink that cargo-xwin looks up on PATH. llvmPackages.llvm
              # gives the raw LLVM binaries (llvm-lib, llvm-ar, llvm-rc);
              # we avoid llvmPackages.bintools because its wrapper symlinks
              # (`strip`, `ar`, ...) collide with same-named symlinks
              # elsewhere in the devshell's buildEnv.
              pkgs.cargo-xwin
              (lib.hiPrio clangXwinShim)
              pkgs.llvmPackages.clang-unwrapped
              pkgs.llvmPackages.llvm
              # aws-win-spinup / aws-win-destroy helpers shell out to these.
              # Pinning them here means teammates on plain Darwin don't need
              # a system awscli install for the devshell command to work.
              pkgs.awscli2
              pkgs.jq
            ]
            ++ darwinBuildInputs
            ++ linuxBuildInputs
            ++ lib.optionals pkgs.stdenv.isLinux [
              # Anchor cc / ld / binutils to THIS flake's nixpkgs revision.
              # Without this, the devshell picks up whatever system cc is on
              # the user's PATH — on NixOS that's often an older-channel
              # glibc, which then mismatches webkitgtk_4_1 (built against
              # unstable's newer glibc) and fails at dynlink time with
              # "version `GLIBC_2.XX' not found".
              pkgs.stdenv.cc
              pkgs.wrapGAppsHook4
            ];

            env = [
              {
                name = "RUST_SRC_PATH";
                value = "${fenixPkgs.latest.rust-src}/lib/rustlib/src/rust/library";
              }
              {
                # cargo-xwin downloads the Microsoft CRT + Windows SDK
                # headers on first Windows cross-build. Setting this to "1"
                # signals acceptance of the Microsoft Software License Terms
                # (https://go.microsoft.com/fwlink/?LinkID=2109288) so the
                # download is non-interactive. The cache lives under
                # ~/.cache/cargo-xwin/xwin and is reused across builds.
                name = "XWIN_ACCEPT_LICENSE";
                value = "1";
              }
            ]
            ++ lib.optionals pkgs.stdenv.isLinux [
              {
                # numtide/devshell doesn't run nixpkgs' pkg-config setup hook,
                # so propagated transitive deps (cairo/pango/atk/...) don't end
                # up on PKG_CONFIG_PATH automatically. Build it by hand from
                # linuxBuildInputs — see the note there about why the full
                # gtk3 closure is listed explicitly.
                name = "PKG_CONFIG_PATH";
                value = lib.makeSearchPath "lib/pkgconfig" (map lib.getDev linuxBuildInputs);
              }
              {
                # Runtime dynamic linker search path. webkit2gtk/gtk/
                # libayatana-appindicator are dlopen'd at `cargo tauri dev`
                # launch time — without this the window never opens.
                name = "LD_LIBRARY_PATH";
                value = lib.makeLibraryPath linuxBuildInputs;
              }
              {
                # Link-time search path replacement for NIX_LDFLAGS.
                # Under `pkgs.mkShell`, the cc-wrapper setup hook would add
                # every buildInput's lib dir to the linker search path.
                # devshell skips that hook, so libs referenced by naked -l
                # entries inside a .pc Libs: field (e.g. `-lz` inside
                # gdk-3.0.pc) are unreachable even though the package is
                # in buildInputs. We hand rustc the full list of -L paths
                # so rust-lld can resolve them during the final link step.
                name = "RUSTFLAGS";
                value = lib.concatStringsSep " " (map (p: "-L${lib.getLib p}/lib") linuxBuildInputs);
              }
              {
                # WebKitGTK's DMA-BUF renderer crashes the Wayland session on
                # current Mesa/compositors with `Gdk-Message: Error 71
                # (Protocol error) dispatching to Wayland display`. Disabling
                # DMA-BUF falls back to a GL-via-EGL path that's stable on
                # GNOME/KDE/Sway on NixOS while still keeping webkit's GL
                # compositor active — which is what drives HiDPI scaling, so
                # leaving compositing mode enabled keeps devicePixelRatio
                # honoring the GTK scale factor. Tauri upstream recommends
                # this workaround until webkit2gtk ships a fix.
                name = "WEBKIT_DISABLE_DMABUF_RENDERER";
                value = "1";
              }
              {
                # glib-networking ships the GIO TLS backend (libgiognutls.so)
                # that webkit uses for every HTTPS request. nixpkgs' setup
                # hook would normally prepend its gio/modules path to
                # GIO_EXTRA_MODULES; devshell doesn't run hooks, so webkit
                # loads with no TLS backend and every fetch to https://
                # errors with `TLS support is not available`. Prepend (don't
                # replace) so inherited gvfs/dconf modules from the host
                # session are still picked up.
                name = "GIO_EXTRA_MODULES";
                prefix = "${pkgs.glib-networking}/lib/gio/modules";
              }
              {
                # Force the app through XWayland. webkit2gtk's native-Wayland
                # path mis-handles fractional scaling on current NixOS
                # compositors: window.devicePixelRatio comes back as -1/96
                # and innerWidth/innerHeight as large negatives, collapsing
                # the entire layout into a negative viewport. XWayland
                # exposes only integer scale factors to the client, which
                # avoids the broken fractional-scale code path entirely.
                # Slight HiDPI fidelity loss vs. native Wayland is an
                # acceptable dev-loop tradeoff until upstream webkit2gtk
                # ships a fix.
                name = "GDK_BACKEND";
                value = "x11";
              }
              {
                # GSettings schema search path. nixpkgs installs compiled
                # schemas at $out/share/gsettings-schemas/$NAME/glib-2.0/
                # schemas/, and GIO walks XDG_DATA_DIRS appending
                # glib-2.0/schemas/ to each entry. Without this prefix, the
                # GTK file chooser aborts the process the first time it's
                # opened (`GLib-GIO-ERROR: No GSettings schemas are
                # installed`). Prepend both the desktop-wide schemas
                # (FileChooser, Interface, etc.) and gtk3's own schemas,
                # preserving any inherited host paths after.
                name = "XDG_DATA_DIRS";
                eval = ''"${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}''${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"'';
              }
            ]
            ++ lib.optionals pkgs.stdenv.isDarwin [
              {
                # Use Apple's native clang — Nix's CC wrapper has SDK version
                # mismatches (e.g. -mmacosx-version-min=26.4) that break aws-lc-sys
                name = "CC";
                value = "/usr/bin/cc";
              }
              {
                # Pin the C++ compiler to Apple's clang++ too. Without this
                # override, `cc-rs` (used by mlua-sys to build Luau and by
                # libsqlite3-sys/objc2 for their C++ shims) resolves `c++`
                # from PATH. On a nix-darwin system that's typically a
                # /run/current-system/sw/bin/c++ symlink into the GCC
                # wrapper, which compiles against libstdc++ (producing
                # `std::__cxx11::...` and `std::__glibcxx_assert_fail`
                # references). The final link uses Apple clang which pulls
                # in libc++ (`std::__1::...`), so the libstdc++ symbols go
                # undefined. Forcing CXX to Apple's clang++ keeps the
                # whole toolchain on libc++.
                name = "CXX";
                value = "/usr/bin/c++";
              }
              {
                # `cc-rs` reads the HOST_ variants for build-script-side
                # compilation. Set them too so build scripts (e.g. tauri
                # codegen, proc macros that shell out) don't fall back to
                # the nix-darwin GCC wrapper either.
                name = "HOST_CC";
                value = "/usr/bin/cc";
              }
              {
                name = "HOST_CXX";
                value = "/usr/bin/c++";
              }
              {
                name = "CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER";
                value = "/usr/bin/cc";
              }
              {
                # Clear system CFLAGS that leak through direnv from nix-darwin
                name = "CFLAGS";
                value = "";
              }
              {
                name = "CXXFLAGS";
                value = "";
              }
            ];

            commands = [
              {
                name = "dev";
                command = "cd src/ui && bun install && cd ../.. && cargo tauri dev --features devtools,server";
                help = "Start Tauri dev mode with hot-reload (includes embedded server)";
                category = "development";
              }
              {
                name = "build-app";
                command = "cargo tauri icon assets/logo.png && cargo tauri build --features server";
                help = "Build release app bundle (.app / .deb) with embedded server";
                category = "development";
              }
              {
                name = "check";
                command = ''
                  mkdir -p src/ui/dist
                  [ -f src/ui/dist/index.html ] || echo '<html></html>' > src/ui/dist/index.html
                  cargo clippy --workspace --all-targets -- -D warnings && cd src/ui && bunx tsc --noEmit
                '';
                help = "Run clippy + TypeScript type checks";
                category = "quality";
              }
              {
                name = "fmt";
                command = "cargo fmt --all && cd src/ui && bunx eslint --fix .";
                help = "Format Rust and TypeScript code";
                category = "quality";
              }
              {
                name = "run-tests";
                command = "cargo test --workspace --all-features";
                help = "Run all Rust tests";
                category = "quality";
              }
              {
                name = "build-win-arm64";
                command = ''
                  set -euo pipefail
                  # Rebuild the frontend — tauri-codegen bakes src/ui/dist/
                  # into the .exe at build time, so a stale dist silently
                  # produces a stale binary.
                  (cd src/ui && bun install --frozen-lockfile && bun run build)
                  # Cross-compile the Tauri binary. Three things make this
                  # the correct invocation:
                  #
                  # 1. --features tauri/custom-protocol — without this,
                  #    tauri-build emits cargo:rustc-cfg=dev and the
                  #    resulting binary loads http://localhost:1420 at
                  #    runtime instead of the embedded asset protocol.
                  #    `cargo tauri build` passes this automatically;
                  #    plain `cargo build`/`cargo xwin build` do not.
                  # 2. Default cargo-xwin mode (clang-cl) — the devshell's
                  #    clangXwinShim rewrites /imsvc → -isystem so ring's
                  #    direct-clang .S assembly compile doesn't choke on
                  #    MSVC-style include flags leaked into CFLAGS.
                  # 3. --release — tauri-codegen embeds the frontend only
                  #    when the binary isn't in debug profile.
                  #
                  # We skip `cargo tauri build --runner` because tauri-cli
                  # shells out to rustup to verify the target is installed,
                  # and our fenix toolchain supplies the rust-std outside
                  # rustup's knowledge. Driving `cargo xwin build` directly
                  # sidesteps the check; asset embedding is handled by
                  # the feature flag above.
                  cargo xwin build --release \
                    --features tauri/custom-protocol \
                    --target aarch64-pc-windows-msvc -p claudette-tauri
                  echo ""
                  echo "Built: $PWD/target/aarch64-pc-windows-msvc/release/claudette.exe"
                '';
                help = "Cross-compile claudette.exe for aarch64-pc-windows-msvc (Windows on ARM)";
                category = "windows";
              }
              {
                name = "deploy-win-arm64";
                command = ''
                  set -euo pipefail
                  # Build, then stop any running instance on the test VM and
                  # copy the fresh .exe over. The remote process has a file
                  # lock on claudette.exe while running, so scp cannot
                  # overwrite it without the Stop-Process step.
                  #
                  # Host and remote path are overridable for cases where the
                  # VM's DHCP lease changes or someone else tests against a
                  # different machine. Defaults match the project's shared
                  # Windows-on-ARM test VM (see project memory).
                  HOST=''${CLAUDETTE_WIN_HOST:-brink@172.16.52.129}
                  REMOTE_PATH=''${CLAUDETTE_WIN_REMOTE_PATH:-OneDrive/Desktop/claudette.exe}
                  build-win-arm64
                  echo ""
                  echo "Stopping running claudette on $HOST (if any)..."
                  ssh "$HOST" 'Stop-Process -Name claudette -Force -ErrorAction SilentlyContinue'
                  echo "Copying to $HOST:$REMOTE_PATH ..."
                  scp target/aarch64-pc-windows-msvc/release/claudette.exe "$HOST:$REMOTE_PATH"
                  echo ""
                  echo "Deployed. Double-click claudette.exe on the VM desktop to run."
                '';
                help = "Build + deploy aarch64-pc-windows-msvc exe to the test VM (overridable via CLAUDETTE_WIN_HOST / CLAUDETTE_WIN_REMOTE_PATH)";
                category = "windows";
              }
              {
                name = "build-win-x64";
                command = ''
                  set -euo pipefail
                  (cd src/ui && bun install --frozen-lockfile && bun run build)
                  cargo xwin build --release \
                    --features tauri/custom-protocol \
                    --target x86_64-pc-windows-msvc -p claudette-tauri
                  echo ""
                  echo "Built: $PWD/target/x86_64-pc-windows-msvc/release/claudette.exe"
                '';
                help = "Cross-compile claudette.exe for x86_64-pc-windows-msvc";
                category = "windows";
              }
              {
                name = "deploy-win-x64";
                command = ''
                  set -euo pipefail
                  # Parallel of deploy-win-arm64. Used against fresh EC2
                  # Windows hosts launched by aws-win-spinup — those default
                  # to Administrator@... with Desktop\ at the profile root
                  # (no OneDrive redirect, unlike James's personal test VM).
                  HOST=''${CLAUDETTE_WIN_HOST:-Administrator@CHANGEME}
                  REMOTE_PATH=''${CLAUDETTE_WIN_REMOTE_PATH:-Desktop/claudette.exe}
                  if [ "$HOST" = "Administrator@CHANGEME" ]; then
                    echo "error: set CLAUDETTE_WIN_HOST (e.g. 'eval \"\$(aws-win-spinup)\"')" >&2
                    exit 1
                  fi
                  build-win-x64
                  echo ""
                  echo "Stopping running claudette on $HOST (if any)..."
                  ssh -o StrictHostKeyChecking=accept-new "$HOST" 'Stop-Process -Name claudette -Force -ErrorAction SilentlyContinue'
                  echo "Copying to $HOST:$REMOTE_PATH ..."
                  scp -o StrictHostKeyChecking=accept-new target/x86_64-pc-windows-msvc/release/claudette.exe "$HOST:$REMOTE_PATH"
                  echo ""
                  echo "Deployed. Double-click claudette.exe on the remote Desktop to run."
                '';
                help = "Build + deploy x86_64-pc-windows-msvc exe to CLAUDETTE_WIN_HOST (e.g. an aws-win-spinup instance)";
                category = "windows";
              }
              {
                name = "aws-win-spinup";
                command = ''
                  set -euo pipefail
                  # Spin up an ephemeral, publicly-reachable Windows Server
                  # EC2 instance with OpenSSH enabled, the caller's pubkey
                  # pre-authorized, and a known Administrator password baked
                  # in via user-data. Prints `export` lines that point the
                  # deploy-win-* helpers at it and store the admin password
                  # in $TMPDIR for aws-win-rdp to pick up.
                  #
                  # Usage:
                  #   eval "$(nix develop -c aws-win-spinup)"
                  #   aws-win-rdp                # opens Windows App (macOS)
                  #   deploy-win-x64             # build + copy claudette.exe
                  #   aws-win-destroy            # when finished
                  #
                  # Everything is tagged Project=claudette-spinup so
                  # aws-win-destroy can find and terminate the fleet.
                  #
                  # Defaults are chosen so a teammate with a standard
                  # ~/.ssh/id_ed25519.pub just works — no RSA-specific path
                  # is required because the admin password is set by user-
                  # data rather than decrypted via get-password-data.
                  PROFILE=''${AWS_PROFILE:-dev.urandom.io}
                  REGION=''${AWS_REGION:-us-west-2}
                  # Fallback chain for the default pubkey: try ed25519 first
                  # (present on 99% of dev Macs), then rsa, then the legacy
                  # project key. SPINUP_PUB_KEY overrides everything.
                  if [ -n "''${SPINUP_PUB_KEY:-}" ]; then
                    PUB_KEY_FILE="$SPINUP_PUB_KEY"
                  elif [ -r "$HOME/.ssh/id_ed25519.pub" ]; then
                    PUB_KEY_FILE="$HOME/.ssh/id_ed25519.pub"
                  elif [ -r "$HOME/.ssh/id_rsa.pub" ]; then
                    PUB_KEY_FILE="$HOME/.ssh/id_rsa.pub"
                  else
                    PUB_KEY_FILE="$HOME/.ssh/dev.urandom.io.pub"
                  fi
                  SG_NAME=''${SPINUP_SG_NAME:-claudette-spinup-sg}
                  INSTANCE_TYPE=''${SPINUP_INSTANCE_TYPE:-t3.medium}
                  NAME_TAG=''${SPINUP_NAME_TAG:-claudette-spinup-$(date +%Y%m%d-%H%M%S)}
                  AMI_FILTER=''${SPINUP_AMI_FILTER:-Windows_Server-2022-English-Full-Base-*}
                  # Admin password: caller can pin one for reproducibility,
                  # otherwise generate 32 hex chars + `Aa1!` to guarantee
                  # all four Windows local-policy character classes (upper,
                  # lower, digit, symbol) without introducing characters
                  # that need PowerShell escaping.
                  ADMIN_PASS=''${SPINUP_ADMIN_PASSWORD:-$(openssl rand -hex 16)Aa1!}

                  log() { echo "[aws-win-spinup] $*" >&2; }
                  aws_() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

                  [ -r "$PUB_KEY_FILE" ] || { log "pubkey $PUB_KEY_FILE not readable"; exit 1; }
                  PUBKEY=$(cat "$PUB_KEY_FILE")
                  log "pubkey: $PUB_KEY_FILE"

                  # No EC2 key pair: ed25519 is not accepted for Windows
                  # AMIs ("Unsupported: ED25519 key pairs are not supported
                  # with Windows AMIs"), and we don't need one because
                  # user-data installs the pubkey into
                  # administrators_authorized_keys directly. Side benefit:
                  # get-password-data becomes a non-option, which forces
                  # us down the user-data-password path (already the
                  # simplest and most reliable).

                  # 1. Security group: 22 + 3389 open to 0.0.0.0/0 (ephemeral).
                  VPC_ID=$(aws_ ec2 describe-vpcs \
                    --filters "Name=is-default,Values=true" \
                    --query 'Vpcs[0].VpcId' --output text)
                  [ "$VPC_ID" != "None" ] || { log "no default VPC in $REGION"; exit 1; }
                  SG_ID=$(aws_ ec2 describe-security-groups \
                    --filters "Name=group-name,Values=$SG_NAME" "Name=vpc-id,Values=$VPC_ID" \
                    --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo None)
                  if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
                    log "creating security group $SG_NAME in $VPC_ID"
                    SG_ID=$(aws_ ec2 create-security-group \
                      --group-name "$SG_NAME" \
                      --description "Claudette ephemeral Windows test SG (SSH+RDP public)" \
                      --vpc-id "$VPC_ID" \
                      --tag-specifications "ResourceType=security-group,Tags=[{Key=Project,Value=claudette-spinup}]" \
                      --query 'GroupId' --output text)
                    aws_ ec2 authorize-security-group-ingress --group-id "$SG_ID" \
                      --ip-permissions \
                        'IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=0.0.0.0/0,Description=ssh}]' \
                        'IpProtocol=tcp,FromPort=3389,ToPort=3389,IpRanges=[{CidrIp=0.0.0.0/0,Description=rdp}]' \
                      >/dev/null
                  fi
                  log "security group: $SG_ID"

                  # 2. Latest Windows Server 2022 AMI (amazon-owned).
                  AMI_ID=$(aws_ ec2 describe-images --owners amazon \
                    --filters "Name=name,Values=$AMI_FILTER" "Name=architecture,Values=x86_64" "Name=state,Values=available" \
                    --query 'sort_by(Images, &CreationDate)[-1].ImageId' --output text)
                  [ -n "$AMI_ID" ] && [ "$AMI_ID" != "None" ] || { log "no AMI matching $AMI_FILTER"; exit 1; }
                  log "AMI: $AMI_ID"

                  # 3. Render user-data. EC2Launch v2 runs the <powershell>
                  #    block once on first boot. Windows Server 2022 ships
                  #    OpenSSH Server pre-installed — just enable, start, and
                  #    drop the pubkey into administrators_authorized_keys
                  #    (takes precedence over per-user ~/.ssh/authorized_keys
                  #    for anyone in the local Administrators group).
                  USER_DATA=$(mktemp)
                  trap 'rm -f "$USER_DATA"' EXIT
                  cat > "$USER_DATA" <<EOF
<powershell>
\$ErrorActionPreference = 'Stop'
try {
  # Pin the Administrator password to our known value before anything else
  # so if the rest of user-data fails, RDP is still usable for diagnosis.
  # PowerShell here-string with single quotes is literal — $ADMIN_PASS only
  # contains hex + Aa1! so it's safe to interpolate without escaping.
  net user Administrator '$ADMIN_PASS' | Out-Null

  Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 -ErrorAction SilentlyContinue | Out-Null
  Set-Service -Name sshd -StartupType Automatic
  Start-Service sshd
  if (!(Test-Path 'C:\ProgramData\ssh')) { New-Item -ItemType Directory -Path 'C:\ProgramData\ssh' | Out-Null }
  \$authKey = 'C:\ProgramData\ssh\administrators_authorized_keys'
  \$pub = @'
$PUBKEY
'@
  Set-Content -Path \$authKey -Value \$pub -Encoding ascii
  icacls.exe \$authKey /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null
  if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
  }
  New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -Value 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -PropertyType String -Force | Out-Null
  Restart-Service sshd
} catch {
  Write-Host "user-data error: \$_"
  throw
}
</powershell>
<persist>false</persist>
EOF

                  # 4. Launch. Intentionally no --key-name (see note above).
                  log "launching $INSTANCE_TYPE ($NAME_TAG)"
                  INSTANCE_ID=$(aws_ ec2 run-instances \
                    --image-id "$AMI_ID" \
                    --instance-type "$INSTANCE_TYPE" \
                    --security-group-ids "$SG_ID" \
                    --user-data "file://$USER_DATA" \
                    --metadata-options 'HttpTokens=required,HttpEndpoint=enabled' \
                    --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=50,VolumeType=gp3,DeleteOnTermination=true}' \
                    --tag-specifications \
                      "ResourceType=instance,Tags=[{Key=Project,Value=claudette-spinup},{Key=Name,Value=$NAME_TAG}]" \
                      "ResourceType=volume,Tags=[{Key=Project,Value=claudette-spinup},{Key=Name,Value=$NAME_TAG}]" \
                    --query 'Instances[0].InstanceId' --output text)
                  log "instance: $INSTANCE_ID — waiting for running state"
                  aws_ ec2 wait instance-running --instance-ids "$INSTANCE_ID"
                  PUBLIC_IP=$(aws_ ec2 describe-instances --instance-ids "$INSTANCE_ID" \
                    --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
                  log "public IP: $PUBLIC_IP — waiting for sshd (Windows first-boot + user-data is slow, ~5-8 min)"

                  # 5. Poll sshd via ssh-keyscan. Using ssh-keyscan (not a
                  #    full ssh login) dodges two orthogonal problems:
                  #    - passphrase-protected private keys need a TTY for
                  #      ssh to prompt, so BatchMode=yes auth-polling fails
                  #      forever on perfectly healthy hosts;
                  #    - we'd be confounding "sshd is up" with "my key is
                  #      authorized", and only the first is the helper's
                  #      concern — user-data already installed the key.
                  #    A successful keyscan means sshd finished starting,
                  #    which on Windows is what takes the time.
                  DEADLINE=$(( $(date +%s) + 900 ))
                  while [ $(date +%s) -lt $DEADLINE ]; do
                    if ssh-keyscan -T 5 -t rsa "$PUBLIC_IP" 2>/dev/null | grep -q ssh-rsa; then
                      log "sshd ready"
                      break
                    fi
                    sleep 15
                  done
                  if [ $(date +%s) -ge $DEADLINE ]; then
                    log "timed out waiting for sshd on $PUBLIC_IP (instance $INSTANCE_ID)"
                    log "inspect with: aws --profile $PROFILE --region $REGION ec2 get-console-output --instance-id $INSTANCE_ID --latest --output text"
                    exit 1
                  fi

                  # 6. Stash the password in a mode-600 sidecar under
                  #    $TMPDIR so aws-win-rdp can find it after a shell
                  #    restart. Key insight: the password was baked into
                  #    user-data (visible to anyone with
                  #    ec2:DescribeInstanceAttribute on this account), so
                  #    we've already accepted "password sits in AWS-side
                  #    plaintext for the life of the instance" — dropping
                  #    it in a mode-600 local file doesn't lower the bar.
                  PASS_FILE="''${TMPDIR:-/tmp}/claudette-spinup-$INSTANCE_ID.pass"
                  ( umask 077; printf '%s' "$ADMIN_PASS" > "$PASS_FILE" )

                  # 7. Emit exports on stdout (so `eval "$(aws-win-spinup)"`
                  #    drops them into the caller's shell); human status
                  #    went to stderr via log().
                  cat <<EOF
export CLAUDETTE_WIN_HOST=Administrator@$PUBLIC_IP
export CLAUDETTE_WIN_REMOTE_PATH=Desktop/claudette.exe
export CLAUDETTE_WIN_INSTANCE_ID=$INSTANCE_ID
export CLAUDETTE_WIN_ADMIN_PASSWORD='$ADMIN_PASS'
# Host:    $PUBLIC_IP
# SSH:     ssh Administrator@$PUBLIC_IP
# RDP:     aws-win-rdp            # macOS; opens Windows App with password on clipboard
# Deploy:  deploy-win-x64
# Destroy: aws-win-destroy
EOF
                '';
                help = "Launch ephemeral Windows EC2 (us-west-2) with SSH+pubkey pre-configured; prints export lines for deploy-win-x64";
                category = "windows";
              }
              {
                name = "aws-win-rdp";
                command = ''
                  set -euo pipefail
                  # macOS helper: look up the current aws-win-spinup instance,
                  # generate a minimal .rdp file, try to fetch+copy the
                  # Administrator password, and hand the .rdp to `open` so
                  # the Windows App (formerly Microsoft Remote Desktop)
                  # launches a session. Non-darwin callers exit cleanly.
                  if [ "$(uname)" != "Darwin" ]; then
                    echo "aws-win-rdp is macOS-only (uses 'open' + 'pbcopy')." >&2
                    exit 2
                  fi

                  PROFILE=''${AWS_PROFILE:-dev.urandom.io}
                  REGION=''${AWS_REGION:-us-west-2}
                  INSTANCE_ID=''${CLAUDETTE_WIN_INSTANCE_ID:-}
                  aws_() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

                  # If no instance was exported by aws-win-spinup, pick the
                  # newest running claudette-spinup instance. Keeps the
                  # helper useful across shell restarts where the env var
                  # was lost.
                  if [ -z "$INSTANCE_ID" ]; then
                    INSTANCE_ID=$(aws_ ec2 describe-instances \
                      --filters "Name=tag:Project,Values=claudette-spinup" \
                                "Name=instance-state-name,Values=running" \
                      --query 'sort_by(Reservations[].Instances[], &LaunchTime)[-1].InstanceId' \
                      --output text)
                    [ -n "$INSTANCE_ID" ] && [ "$INSTANCE_ID" != "None" ] \
                      || { echo "no running claudette-spinup instance found" >&2; exit 1; }
                  fi

                  PUBLIC_IP=$(aws_ ec2 describe-instances --instance-ids "$INSTANCE_ID" \
                    --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
                  [ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" != "None" ] \
                    || { echo "instance $INSTANCE_ID has no public IP" >&2; exit 1; }

                  # Password lookup: env var wins (set by `eval aws-win-spinup`),
                  # otherwise read the mode-600 sidecar that aws-win-spinup
                  # wrote. No RSA/PEM/passphrase dance — the password was
                  # baked into user-data, so we already know it.
                  PASS_FILE="''${TMPDIR:-/tmp}/claudette-spinup-$INSTANCE_ID.pass"
                  PASSWORD="''${CLAUDETTE_WIN_ADMIN_PASSWORD:-}"
                  if [ -z "$PASSWORD" ] && [ -r "$PASS_FILE" ]; then
                    PASSWORD=$(cat "$PASS_FILE")
                  fi
                  if [ -n "$PASSWORD" ]; then
                    printf %s "$PASSWORD" | pbcopy
                    echo "Administrator password copied to clipboard (⌘-V in the password field)."
                  else
                    echo "(no cached password found — was this instance launched by aws-win-spinup?)"
                    echo "  expected file: $PASS_FILE"
                    echo "  or set CLAUDETTE_WIN_ADMIN_PASSWORD before calling aws-win-rdp"
                  fi

                  # Minimal .rdp file — Windows App is happy with just the
                  # address + username. Host key / CA / gateway are left
                  # unset; the client will prompt on first connect.
                  # Fixed path (not mktemp): a .rdp is disposable, and reusing
                  # the same path means re-running against the same instance
                  # doesn't litter $TMPDIR. Also sidesteps the GNU/BSD mktemp
                  # template-syntax mismatch the devshell exposes.
                  RDP_FILE="''${TMPDIR:-/tmp}/claudette-spinup-$INSTANCE_ID.rdp"
                  cat > "$RDP_FILE" <<EOF
full address:s:$PUBLIC_IP
username:s:Administrator
prompt for credentials:i:1
EOF
                  echo "opening $RDP_FILE -> $PUBLIC_IP"
                  open "$RDP_FILE"
                '';
                help = "macOS: generate a .rdp, copy Admin password to clipboard, and open the current aws-win-spinup instance in Windows App";
                category = "windows";
              }
              {
                name = "aws-win-destroy";
                command = ''
                  set -euo pipefail
                  # Terminate every instance tagged Project=claudette-spinup
                  # in the target region. Safe to run with none present.
                  PROFILE=''${AWS_PROFILE:-dev.urandom.io}
                  REGION=''${AWS_REGION:-us-west-2}
                  aws_() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

                  mapfile -t IDS < <(aws_ ec2 describe-instances \
                    --filters "Name=tag:Project,Values=claudette-spinup" \
                              "Name=instance-state-name,Values=pending,running,stopping,stopped" \
                    --query 'Reservations[].Instances[].InstanceId' --output text | tr '\t' '\n' | sed '/^$/d')
                  if [ ''${#IDS[@]} -eq 0 ]; then
                    echo "no claudette-spinup instances to destroy in $REGION"
                    exit 0
                  fi
                  echo "terminating: ''${IDS[*]}"
                  aws_ ec2 terminate-instances --instance-ids "''${IDS[@]}" \
                    --query 'TerminatingInstances[].[InstanceId,CurrentState.Name]' --output text
                  aws_ ec2 wait instance-terminated --instance-ids "''${IDS[@]}"
                  # Scrub the local password + .rdp sidecars for these
                  # instances so their plaintext admin password doesn't
                  # linger in $TMPDIR after the instance is gone.
                  for ID in "''${IDS[@]}"; do
                    rm -f "''${TMPDIR:-/tmp}/claudette-spinup-$ID.pass" \
                          "''${TMPDIR:-/tmp}/claudette-spinup-$ID.rdp" 2>/dev/null || true
                  done
                  echo "terminated."
                  echo "note: keypair and SG (claudette-spinup-sg) are left in place for reuse."
                '';
                help = "Terminate all claudette-spinup tagged EC2 instances in AWS_REGION (default us-west-2)";
                category = "windows";
              }
              {
                name = "coverage";
                command = ''
                  mkdir -p src/ui/dist
                  [ -f src/ui/dist/index.html ] || echo '<html></html>' > src/ui/dist/index.html
                  cargo llvm-cov --workspace --all-features --lcov --output-path lcov.info
                  cargo llvm-cov report --html
                  cargo llvm-cov report
                  echo ""
                  echo "lcov:  lcov.info"
                  echo "html:  target/llvm-cov/html/index.html"
                '';
                help = "Run tests with coverage (terminal summary + lcov + HTML report)";
                category = "quality";
              }
            ];
          };

          # -- Formatting --------------------------------------------------------
          treefmt = {
            projectRootFile = "flake.nix";
            programs.nixfmt.enable = true;
            programs.rustfmt = {
              enable = true;
              package = rustToolchain;
            };
          };
        };
    };
}
