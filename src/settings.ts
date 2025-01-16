import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
export const CONF_DEBUG_ADAPTER = "debug_adapter.debugAdapterPath";
export const CONF_DEBUG_ADAPTER_START_TIMEOUT = "debug_adapter.debugAdapterStartServerTimeout";


function debugAdapterPath(): string {
    const debugAdapterPath = vscode.workspace.getConfiguration().get(CONF_DEBUG_ADAPTER, "");
    if(!fs.existsSync(debugAdapterPath)) {
        throw new Error(
            `Invalid path in Debug Adapter: ${debugAdapterPath}.\n` +
            `Please specify Debug_adapter: Debug Adapter Path in the extension settings.`
        );
    }
    return debugAdapterPath;
}

export function runDebugAdapterScriptPath(): string {
    return path.join(debugAdapterPath(), "bin/run_debug_adapter");
}

export function startDebugAdapterServerTimeoutInSeconds(): number {
    return vscode.workspace.getConfiguration().get(CONF_DEBUG_ADAPTER_START_TIMEOUT, 10);
}
