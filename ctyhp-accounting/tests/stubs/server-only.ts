/**
 * `server-only` is a build-time marker: importing it from a client bundle is
 * meant to fail the build. Under vitest there is no client bundle and no
 * resolver for it, so a service that (correctly) guards itself this way cannot
 * be imported by a test at all.
 *
 * This stub restores the ability to test those services. It does not weaken the
 * guarantee — that lives in the Next.js build, which still refuses a client
 * import — it only stops a marker meant for the bundler from deciding what may
 * be unit tested.
 */
export {};
