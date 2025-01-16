import * as vscode from "vscode";
import { DebugAdapterFactory } from "./debugAdapterFactory";

let factory: DebugAdapterFactory | undefined;

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel("Debug Adapter Logs");

    factory = new DebugAdapterFactory(outputChannel);

    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory("debug_adapter", factory),
        factory, // The factory will be released automatically
        outputChannel // Freeing the log channel
    );

    vscode.debug.onDidTerminateDebugSession((session) => {
        if (session.configuration.type === "debug_adapter") {
            outputChannel.appendLine(`Debug session terminated: ${session.name}`);
        }
    });
}

export function deactivate() {
    factory?.dispose();
    factory = undefined;
}
