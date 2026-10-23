import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {DEFAULT_TAG, resolveUpstream} from "./sync-lego-dns-providers.mjs";

export const PINNED_HASHES = {
    "challenge/internal/client.go": "2B992A137AE2F8791ABCF34B8CB5DEDE73074598C0E504E52641711EC6D1222D",
    "challenge/internal/client_zone.go": "60A20BEC1EC0138BB8D19C81D005861093243C385DD44E4EF88D91F6BC68D3A4",
    "challenge/dns01/client_nameservers.go": "C112E49B5F918BA5C82A7D8AB0399F49425DAF3F45D23D19C679255CED21557D",
};

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function verifyPinnedSource(relativePath, content, expectedHash) {
    const actualHash = createHash("sha256").update(content).digest("hex").toUpperCase();
    if (actualHash !== expectedHash) {
        throw new Error(`Pinned lego source changed: ${relativePath}; expected ${expectedHash}, got ${actualHash}`);
    }
    return actualHash;
}

export function createOverlay({sourceRoot, outputDirectory, projectRoot = PROJECT_ROOT, expectedHashes = PINNED_HASHES}) {
    const replacements = {};
    mkdirSync(outputDirectory, {recursive: true});
    for (const [relativePath, expectedHash] of Object.entries(expectedHashes)) {
        const upstreamPath = join(sourceRoot, relativePath);
        let overridePath = join(projectRoot, "tests", "lego-wasm-probe", "overlay", relativePath);
        const upstream = readFileSync(upstreamPath, "utf8");
        verifyPinnedSource(relativePath, upstream, expectedHash);
        if (relativePath === "challenge/internal/client.go") {
            const start = upstream.indexOf("func (c *Client) SendQueryCustom(");
            const end = upstream.indexOf("func (c *Client) exchange(", start);
            if (start < 0 || end < start) throw new Error("Shared DNS patch context changed");
            const replacement = `func (c *Client) SendQueryCustom(ctx context.Context, fqdn string, rtype uint16, nameservers []string, recursive bool) (*dns.Msg, error) {
    message, err := queryDoH(ctx, fqdn, rtype)
    if err != nil { return nil, err }
    result := createDNSMsg(fqdn, rtype, true)
    result.Rcode = message.Status
    for _, answer := range message.Answer {
        record, parseErr := dns.NewRR(fmt.Sprintf("%s %d IN %s %s", answer.Name, answer.TTL, dns.TypeToString[answer.Type], answer.Data))
        if parseErr != nil { return nil, fmt.Errorf("invalid DoH record") }
        result.Answer = append(result.Answer, record)
    }
    return result, nil
}

`;
            overridePath = join(outputDirectory, "client.go");
            writeFileSync(overridePath, (upstream.slice(0, start) + replacement + upstream.slice(end)).replace('"errors"', '"fmt"'), "utf8");
        } else readFileSync(overridePath, "utf8");
        replacements[upstreamPath] = overridePath;
    }

    mkdirSync(outputDirectory, {recursive: true});
    const overlayPath = join(outputDirectory, "overlay.json");
    writeFileSync(overlayPath, `${JSON.stringify({Replace: replacements}, null, 2)}\n`, "utf8");
    return {overlayPath, replacements};
}

function parseArgs(args) {
    const options = {tag: DEFAULT_TAG};
    for (let index = 0; index < args.length; index++) {
        const value = args[index];
        if (value === "--tag") options.tag = args[++index];
        else if (value === "--source-dir") options.sourceRoot = resolve(args[++index]);
        else if (value === "--output-dir") options.outputDirectory = resolve(args[++index]);
        else throw new Error(`Unknown argument: ${value}`);
    }
    if (options.tag !== DEFAULT_TAG) throw new Error(`The DoH overlay is verified only for ${DEFAULT_TAG}`);
    return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const options = parseArgs(process.argv.slice(2));
        const sourceRoot = options.sourceRoot ?? resolveUpstream(options.tag);
        const outputDirectory = options.outputDirectory ?? join(PROJECT_ROOT, "tests", "lego-wasm-probe", ".wrangler", "lego-v5.5.2");
        const result = createOverlay({sourceRoot, outputDirectory});
        process.stdout.write(`Verified ${Object.keys(result.replacements).length} pinned lego source files.\n`);
        process.stdout.write(`Overlay: ${result.overlayPath}\n`);
    } catch (error) {
        process.stderr.write(`${error.stack ?? error}\n`);
        process.exitCode = 1;
    }
}