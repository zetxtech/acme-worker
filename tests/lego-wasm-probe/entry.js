import module from "./selected.wasm";
import "./runtime-shim.js";
import "./wasm_exec.js";

let pending = Promise.resolve();

export default {
    async fetch() {
        const run = pending.then(async () => {
            delete globalThis.legoProbeResult;
            const go = new Go();
            const instance = await WebAssembly.instantiate(module, go.importObject);
            await go.run(instance);
            return Response.json({...JSON.parse(globalThis.legoProbeResult ?? "{}"), entryVersion: "v5-doh-lifecycle"});
        });
        pending = run.catch(() => {});
        return run;
    },
};