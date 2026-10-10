const api = Bun.spawn(["cargo", "run", "-p", "archhub-core", "--", "serve"], {
  stdout: "inherit",
  stderr: "inherit",
});
const web = Bun.spawn(["bun", "run", "dev:web"], { stdout: "inherit", stderr: "inherit" });
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  api.kill();
  web.kill();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
const code = await Promise.race([api.exited, web.exited]);
shutdown();
process.exit(code);
