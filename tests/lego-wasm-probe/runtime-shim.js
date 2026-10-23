const runtimeProcess = globalThis.process ?? {};

for (const [name, value] of Object.entries({
  getuid: () => -1,
  getgid: () => -1,
  geteuid: () => -1,
  getegid: () => -1,
  getgroups: () => [],
  cwd: () => "/",
  umask: () => 0,
})) {
  if (typeof runtimeProcess[name] !== "function") runtimeProcess[name] = value;
}

if (!globalThis.process) globalThis.process = runtimeProcess;