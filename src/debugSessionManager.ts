import * as vscode from 'vscode';
import { ProcessesTreeDataProvider, DebugProcess } from "./processesView";

interface ListProcessesResponse {
    processes: Array<{ pid: number; name: string }>;
    currentProcess?: number;
}

interface ExitedProcessEventBody {
    pid: number;
}

interface ContinueAfterExitResponse {
    continue: boolean;
}

export class DebugSessionManager {
    private attached = false;
    private listProcessesCalled = false;

    constructor(
        private processesProvider: ProcessesTreeDataProvider,
        private outputChannel: vscode.OutputChannel
    ) {}

    public createTracker(session: vscode.DebugSession): vscode.DebugAdapterTracker {
        return {
            onWillReceiveMessage: (message) => {
                this.log(`→ Adapter message: ${JSON.stringify(message, null, 2)}`);
            },

            onDidSendMessage: async (message) => {
                this.log(`← Adapter message: ${JSON.stringify(message, null, 2)}`);

                // Query processes after debug session initialization - after receiving stackTrace response.
                if (message.type === "response" && message.command === "attach") {
                    this.attached = true;
                }

                if (
                    this.attached &&
                    message.type === "response" &&
                    message.command === "stackTrace" &&
                    !this.listProcessesCalled
                ) {
                    await this.updateProcessesFromAdapter(session);
                }

                if (message.type === "event" && message.event === "exitedProcess") {
                    const body = message.body as ExitedProcessEventBody;
                    this.log(`Process exited: ${JSON.stringify(body)}`);
                    vscode.window.showWarningMessage(
                        "The debugged process has terminated. See logs for more info.",
                        { modal: false }
                    );

                    try {
                        const response = await session.customRequest("continueAfterProcessExit", {}) as ContinueAfterExitResponse;
                        if (response?.continue === true) {
                            await this.updateProcessesFromAdapter(session);
                        } else {
                            vscode.debug.stopDebugging(session);
                        }
                    } catch (error) {
                        this.log(`Error handling exitedProcess: ${error}`);
                    }
                }
            }
        };
    }

    public onDidTerminateDebugSession(session: vscode.DebugSession) {
        this.log(`Debug session terminated: ${session.name}`);
        this.processesProvider.updateProcesses([], 0);
        vscode.commands.executeCommand("setContext", "debug_adapter.hasProcesses", false);

        this.attached = false;
        this.listProcessesCalled = false;
    }

    private async updateProcessesFromAdapter(session: vscode.DebugSession) {
        this.listProcessesCalled = true;

        try {
            const response = await session.customRequest("listProcesses", {}) as ListProcessesResponse;
            if (response && Array.isArray(response.processes)) {
                const processes: DebugProcess[] = response.processes.map((p) => ({
                    pid: p.pid,
                    name: p.name
                }));

                const currentPid = response.currentProcess ?? 0;
                const activeProcess = processes.find(p => p.pid === currentPid) || processes[0];

                this.processesProvider.updateProcesses(processes, activeProcess?.pid ?? 0);

                vscode.commands.executeCommand("setContext", "debug_adapter.hasProcesses", true);
            }
        } catch (error) {
            this.log(`Failed to fetch processes: ${error}`);
        }
    }

    private log(message: string) {
        this.outputChannel.appendLine(message);
    }
}
