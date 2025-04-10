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

interface HandleNewProcessResponse {
    processes: Array<{ pid: number; name: string }>;
    currentProcess?: number;
}

export class DebugSessionManager {
    private attached = false;
    private listProcessesCalled = false;
    private spawnerPid?: number;
    private launchedWithoutSpawner = false;

    constructor(
        private processesProvider: ProcessesTreeDataProvider,
        private outputChannel: vscode.OutputChannel
    ) {}

    public createTracker(session: vscode.DebugSession): vscode.DebugAdapterTracker {
        let launchPromiseResolver: (() => void) | null = null;
        let launchPromise: Promise<void> | null = null;

        // Function for showing the program startup indicator.
        const startLaunchProgress = (): void => {
            launchPromise = new Promise<void>((resolve) => {
                launchPromiseResolver = resolve;
            });
            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Launching the program...",
                    cancellable: false
                },
                () => launchPromise!
            );
        };

        return {
            onWillReceiveMessage: (message) => {
                this.log(`→ Adapter message: ${JSON.stringify(message, null, 2)}`);
                if (message.type === "request" && message.command === "launch") {
                    startLaunchProgress();
                }
            },

            onDidSendMessage: async (message) => {
                this.log(`← Adapter message: ${JSON.stringify(message, null, 2)}`);

                // Processing the response to the "launch" command
                if (message.type === "response" && message.command === "launch") {
                    launchPromiseResolver?.();
                    launchPromiseResolver = null;
                    if (message.body?.spawnerPid) {
                        this.spawnerPid = message.body.spawnerPid;
                        this.log(`Spawner PID received: ${this.spawnerPid}`);
                    } else {
                        this.launchedWithoutSpawner = true;
                    }
                }

                // Processing response to the "attach" command
                if (message.type === "response" && message.command === "attach") {
                    this.attached = true;
                }

                // If a response to the "stackTrace" command is received and
                // the process has not yet been updated, we request an update of the process list
                if (
                    (this.attached || this.launchedWithoutSpawner) &&
                    message.type === "response" &&
                    message.command === "stackTrace" &&
                    !this.listProcessesCalled
                ) {
                    await this.updateProcessesFromAdapter(session);
                }

                if (message.type === "event") {
                    if (message.event === "exitedProcess") {
                        await this.handleExitedProcessEvent(session, message.body as ExitedProcessEventBody);
                    } else if (message.event === "newProcess") {
                        await this.handleNewProcessEvent(session, message.body);
                    }
                }
            }
        };
    }

    public onDidTerminateDebugSession(session: vscode.DebugSession): void {
        this.log(`Debug session terminated: ${session.name}`);
        this.processesProvider.updateProcesses([], 0);
        vscode.commands.executeCommand("setContext", "debug_adapter.hasProcesses", false);

        this.attached = false;
        this.listProcessesCalled = false;
        this.spawnerPid = undefined;
        this.launchedWithoutSpawner = false;
    }

    private async updateProcessesFromAdapter(session: vscode.DebugSession): Promise<void> {
        this.listProcessesCalled = true;
        try {
            const response = await session.customRequest("listProcesses", {}) as ListProcessesResponse;
            if (response?.processes) {
                this.updateProcesses(response.processes, response.currentProcess);
            }
        } catch (error) {
            this.log(`Failed to fetch processes: ${error}`);
        }
    }

    private async handleExitedProcessEvent(session: vscode.DebugSession, body: ExitedProcessEventBody): Promise<void> {
        this.log(`Process exited: ${JSON.stringify(body)}`);
        vscode.window.showWarningMessage(
            "The debugged process has terminated. See logs for more info.",
            { modal: false }
        );
        try {
            const response = await session.customRequest("continueAfterProcessExit", {}) as ContinueAfterExitResponse;
            if (response?.continue) {
                await this.updateProcessesFromAdapter(session);
            } else {
                vscode.debug.stopDebugging(session);
            }
        } catch (error) {
            this.log(`Error handling exitedProcess: ${error}`);
        }
    }

    private async handleNewProcessEvent(session: vscode.DebugSession, body: unknown): Promise<void> {
        this.log(`New process event received: ${JSON.stringify(body, null, 2)}`);
        try {
            const program = session.configuration.program;
            const response = await session.customRequest("handleNewProcess", {
                spawnerPid: this.spawnerPid,
                program
            }) as HandleNewProcessResponse;

            if (response?.processes) {
                this.updateProcesses(response.processes, response.currentProcess);
            }
        } catch (error) {
            this.log(`Error handling newProcess event: ${error}`);
        }
    }

    private updateProcesses(processList: Array<{ pid: number; name: string }>, currentPid?: number): void {
        const processes: DebugProcess[] = processList.map(({ pid, name }) => ({ pid, name }));
        const activeProcess = processes.find(p => p.pid === currentPid) || processes[0];

        this.processesProvider.updateProcesses(processes, activeProcess?.pid ?? 0);
        vscode.commands.executeCommand("setContext", "debug_adapter.hasProcesses", true);
    }

    private log(message: string): void {
        this.outputChannel.appendLine(message);
    }
}
