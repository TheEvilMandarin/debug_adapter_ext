import * as vscode from 'vscode';

export interface DebugProcess {
    pid: number;
    name: string;
    selected?: boolean;
}

interface ListProcessesResponse {
    processes: { pid: number; name: string }[];
    currentProcess?: number | string | null;
}

interface DetachInferiorsResponse {
    newCurrentPid?: number | string | null;
}

class ProcessItem extends vscode.TreeItem {
    public pid: number;
    constructor(pid: number, name: string, isActive: boolean) {
        const space = '\u2007'; // FIGURE SPACE
        const label = isActive
            ? `✔️ ${name} (PID: ${pid})`
            : `${space.repeat(3)}${name} (PID: ${pid})`;
        super(label, vscode.TreeItemCollapsibleState.None);
        this.pid = pid;
        this.tooltip = label;
        this.contextValue = isActive ? "activeProcess" : "process";
        this.command = {
            title: "Select Inferior",
            command: "debug_adapter.selectInferior",
            arguments: [this],
        };
    }
}

export class ProcessesTreeDataProvider implements vscode.TreeDataProvider<ProcessItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ProcessItem | undefined | void> =
        new vscode.EventEmitter<ProcessItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ProcessItem | undefined | void> =
        this._onDidChangeTreeData.event;

    private processes: DebugProcess[] = [];
    private activeProcess: DebugProcess | null = null;

    constructor(context: vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.commands.registerCommand("debug_adapter.selectInferior", this.selectInferior.bind(this)),
            vscode.commands.registerCommand("debug_adapter.showProcessList", this.showProcessList.bind(this))
        );
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    public updateProcesses(processes: DebugProcess[], activePid: number): void {
        this.processes = processes.map(proc => {
            const existing = this.processes.find(oldProc => oldProc.pid === proc.pid);
            return { ...proc, selected: existing ? existing.selected : false };
        });
        this.activeProcess = this.processes.find(proc => proc.pid === activePid) || null;
        if (this.activeProcess) {
            this.activeProcess.selected = true;
        }
        this.refresh();
    }

    getTreeItem(element: ProcessItem): vscode.TreeItem {
        return element;
    }

    getChildren(): vscode.ProviderResult<ProcessItem[]> {
        return this.processes
            .filter(proc => proc.selected)
            .map(proc => new ProcessItem(proc.pid, proc.name, this.activeProcess?.pid === proc.pid));
    }

    private async selectInferior(item: ProcessItem): Promise<void> {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            vscode.window.showErrorMessage("No active debugging");
            return;
        }
        try {
            await session.customRequest("selectInferior", { pid: item.pid });
            const proc = this.processes.find(proc => proc.pid === item.pid);
            if (proc) {
                this.activeProcess = proc;
                this.refresh();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Process selection error: ${error}`);
        }
    }

    private async fetchProcesses(session: vscode.DebugSession): Promise<ListProcessesResponse | null> {
        try {
            return (await session.customRequest("listProcesses", {})) as ListProcessesResponse;
        } catch (error) {
            vscode.window.showErrorMessage(`Error fetching process list: ${error}`);
            return null;
        }
    }
    
    private mergeProcesses(response: ListProcessesResponse): { merged: DebugProcess[], backup: DebugProcess[] } {
        const merged = response.processes.map(proc => {
            const existing = this.processes.find(exists => exists.pid === proc.pid);
            return {
                pid: proc.pid,
                name: proc.name,
                selected: !!existing?.selected || (proc.pid === response.currentProcess)
            };
        });
        // Create a backup for comparison after selecting a user
        const backup = merged.map(proc => ({ ...proc }));
        return { merged, backup };
    }
    
    private async promptUserForProcessSelection(merged: DebugProcess[]): Promise<DebugProcess[] | null> {
        const quickPickItems: vscode.QuickPickItem[] = merged.map(proc => ({
            label: `${proc.name} (PID: ${proc.pid})`,
            picked: proc.selected
        }));
    
        const selectedItems = await vscode.window.showQuickPick(quickPickItems, {
            canPickMany: true,
            placeHolder: "Select processes to display in the view"
        });
        if (!selectedItems) {
            return null;
        }
    
        // Update the selected state according to the user's choice
        merged.forEach(proc => {
            proc.selected = selectedItems.some(qp => qp.label.endsWith(`(PID: ${proc.pid})`));
        });
        return merged;
    }
    
    private calculatePidDifferences(backup: DebugProcess[], current: DebugProcess[]): { addPids: number[], detachPids: number[] } {
        const backupSelected = new Set(backup.filter(proc => proc.selected).map(proc => proc.pid));
        const currentSelected = new Set(current.filter(proc => proc.selected).map(proc => proc.pid));
    
        const addPids = Array.from(currentSelected).filter(pid => !backupSelected.has(pid));
        const detachPids = Array.from(backupSelected).filter(pid => !currentSelected.has(pid));
        return { addPids, detachPids };
    }
    
    private async showProcessList(): Promise<void> {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            vscode.window.showErrorMessage("No active debugging");
            return;
        }
    
        const response = await this.fetchProcesses(session);
        if (!response || !Array.isArray(response.processes)) {
            return;
        }
    
        // Merge new data with the current state
        const { merged, backup } = this.mergeProcesses(response);
        
        // Set activeProcess based on currentProcess if specified
        if (typeof response.currentProcess === 'number') {
            this.activeProcess = merged.find(proc => proc.pid === response.currentProcess) || null;
        } else {
            this.activeProcess = null;
        }
        this.processes = merged;
        this.refresh();
    
        const updatedProcesses = await this.promptUserForProcessSelection(merged);
        if (!updatedProcesses) {
            // User deselected
            return;
        }
    
        // Calculate changes in selected processes
        const { addPids, detachPids } = this.calculatePidDifferences(backup, updatedProcesses);
        if (addPids.length > 0) {
            await session.customRequest("addInferiors", { pids: addPids });
        }
    
        let detachResponse: DetachInferiorsResponse | undefined;
        if (detachPids.length > 0) {
            detachResponse = (await session.customRequest("detachInferiors", { pids: detachPids })) as DetachInferiorsResponse;
        }
    
        // Define a new activeProcess
        if (detachResponse && typeof detachResponse.newCurrentPid === 'number') {
            this.activeProcess = this.processes.find(proc => proc.pid === detachResponse.newCurrentPid) || null;
        } else if (detachResponse && (detachResponse.newCurrentPid === null || detachResponse.newCurrentPid === 'none')) {
            this.activeProcess = null;
        } else if (typeof response.currentProcess === 'number') {
            this.activeProcess = this.processes.find(proc => proc.pid === response.currentProcess) || null;
        } else {
            this.activeProcess = null;
        }
        this.refresh();
    }
}    
