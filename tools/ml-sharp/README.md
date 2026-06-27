This directory is reserved for the optional bundled apple/ml-sharp runtime.

When a complete runtime is installed here, Electron Builder copies it as an
unpacked resource so Particle Model Studio can run high-quality image-to-
Gaussian-Splat reconstruction from the packaged exe.

The app still includes a built-in zero-install image point-cloud mode, so image
imports remain usable even when this optional runtime is absent.
