import * as vscode from "vscode";
import * as path from "path";
import { spawn, ChildProcess } from "child_process";
import { isValidFilePath } from "./utils";
import { runDebugAdapterScriptPath, startDebugAdapterServerTimeoutInSeconds } from "./settings";


export class DebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    private adapterProcess: ChildProcess | undefined;
    private outputChannel: vscode.OutputChannel;
    private isRunning: boolean = false;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    async createDebugAdapterDescriptor(session: vscode.DebugSession): Promise<vscode.DebugAdapterDescriptor> {
        if (this.isRunning) {
            throw new Error("Debug Adapter supports only one client connection at a time.");
        }

        const runScriptPath = path.join(runDebugAdapterScriptPath(), "");

        const gdbPath = session.configuration.gdbPath || "/usr/bin/gdb";
        if (gdbPath !== "gdb" && !isValidFilePath(gdbPath)) {
            throw new Error(`Invalid GDB path: ${gdbPath}. Please specify a valid path to GDB.`);
        }

        // TODO: do a strict check that the path exists for launch command
        const programPath = session.configuration.program || "";
        if (programPath !== "" && !isValidFilePath(programPath)) {
            throw new Error(`Invalid program path: ${programPath}. Please specify a valid path to the program being debugged.`);
        }

        this.outputChannel.appendLine(`Launching adapter script: ${runScriptPath}`);
        this.outputChannel.appendLine(`GDB Path: ${gdbPath}`);
        this.outputChannel.appendLine(`Program Path: ${programPath}`);

        this.adapterProcess = spawn(runScriptPath, [gdbPath, programPath], {
            stdio: ["pipe", "pipe", "pipe"],
        });

        this.adapterProcess.on("exit", (code) => {
            this.isRunning = false;
            this.outputChannel.appendLine(`Debug Adapter exited with code ${code}`);
        });

        this.adapterProcess.on("error", (err) => {
            this.isRunning = false;
            this.outputChannel.appendLine(`Failed to start Debug Adapter: ${err.message}`);
        });

        const startDebugAdapterServerTimeoutInMs = startDebugAdapterServerTimeoutInSeconds() * 1000;

        await Promise.race([
            new Promise<void>((resolve, reject) => {
                let ready = false;
        
                this.adapterProcess?.stdout?.on("data", (data) => {
                    this.outputChannel.appendLine(`Debug Adapter stdout: ${data}`);
                    if (data.includes("DAP server is listening")) {
                        ready = true;
                        resolve();
                    }
                });

                this.adapterProcess?.stderr?.on("data", (errData) => {
                    this.outputChannel.appendLine(`Debug Adapter stderr: ${errData}`);
                });

                if (this.adapterProcess) {
                    this.adapterProcess.on("error", (err) => {
                        if (!ready) {
                            reject(err);
                        }
                    });
        
                    this.adapterProcess.on("exit", (code) => {
                        if (!ready) {
                            reject(
                                new Error(`Debug Adapter exited with code ${code}, but was never ready.`)
                            );
                        }
                    });
                }
            }),
            new Promise<void>((_, reject) =>
                setTimeout(
                    () => reject(new Error("Timeout waiting for Debug Adapter to be ready")),
                    startDebugAdapterServerTimeoutInMs
                )
            ),
        ]);

        this.isRunning = true;
        return new vscode.DebugAdapterServer(4711);
    }

    dispose() {
        if (this.adapterProcess) {
            this.adapterProcess.kill();
            this.adapterProcess = undefined;
            this.outputChannel.appendLine("Debug Adapter process terminated.");
        }
    }
}
