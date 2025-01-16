import * as fs from "fs";

export function isValidFilePath(path: string): boolean {
    try {
        return fs.existsSync(path) && fs.statSync(path).isFile();
    } catch (err) {
        return false;
    }
}

