import * as vscode from "vscode";
import { DebugAdapterFactory } from "./debugAdapterFactory";
import { ProcessesTreeDataProvider } from "./processesView";
import { DebugSessionManager } from "./debugSessionManager";

let factory: DebugAdapterFactory | undefined;
let processesProvider: ProcessesTreeDataProvider;
let debugSessionManager: DebugSessionManager | undefined;

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel("Debug Adapter Logs");
    factory = new DebugAdapterFactory(outputChannel);

    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory("debug_adapter", factory),
        factory, // The factory will be released automatically
        outputChannel // Freeing the log channel
    );

    processesProvider = new ProcessesTreeDataProvider(context);
    vscode.window.registerTreeDataProvider("debug_adapter.processesView", processesProvider);

    vscode.commands.executeCommand("setContext", "debug_adapter.hasProcesses", false);

    debugSessionManager = new DebugSessionManager(processesProvider, outputChannel);

    vscode.debug.registerDebugAdapterTrackerFactory("debug_adapter", {
        createDebugAdapterTracker: (session: vscode.DebugSession) => {
            return debugSessionManager?.createTracker(session);
        }
    });

    vscode.debug.onDidTerminateDebugSession((session) => {
        if (session.configuration.type === "debug_adapter") {
            debugSessionManager?.onDidTerminateDebugSession(session);
        }
    });
}

export function deactivate() {
    factory?.dispose();
    factory = undefined;
}
