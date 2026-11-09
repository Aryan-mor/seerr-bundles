# seerr-bundles

Ready-to-run [Seerr](https://github.com/seerr-team/seerr) builds for Windows and Linux. No Docker and no Node needed.

Seerr publishes a Docker image and its source code, but no files you can just unpack and run. This
repository builds them from Seerr's official release tags, with the same steps as Seerr's own
Dockerfile, and puts the Node it needs beside it.

## What is in a release

One archive per system, for example `seerr-3.5.1-windows-amd64.tar.gz`:

```
seerr/
  node(.exe)       Node 22.23.4, the version Seerr's image uses
  LICENSE-seerr    Seerr's MIT license
  app/             Seerr's built files and production dependencies
```

Systems: `windows-amd64`, `linux-amd64`, `linux-arm64`. Each release also has `SHA256SUMS.txt`.

## Run one

```
cd seerr/app
CONFIG_DIRECTORY=../../config API_KEY=choose-a-key PORT=5055 HOST=127.0.0.1 NODE_ENV=production ../node dist/index.js
```

On Windows run `..\node.exe`. `CONFIG_DIRECTORY` is where Seerr keeps its database and settings.

## New versions

A workflow runs every day. When Seerr publishes a release that has no bundle here, it builds one.
Run the **Build** workflow by hand with a version to build or rebuild a specific one.

## Build one yourself

On the system you want a bundle for, with git, pnpm 10 and Node exactly 22.23.4 on `PATH`:

```
scripts/seerr-bundle.sh 3.5.1 out
```

The native modules are compiled for the system that builds them, so build on the system it is for.

## Used by

[jellyfin-telegram](https://github.com/Aryan-mor/jellyfin-telegram) downloads these and checks each
file against a pinned SHA-256 before it runs it.

Seerr is MIT licensed, and so is this repository's build code.
