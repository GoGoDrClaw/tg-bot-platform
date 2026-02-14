import { spawn } from "child_process";

export async function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false });
    let buffer = "";
    let error = "";

    child.stdout.on("data", (data) => (buffer += data.toString()));
    child.stderr.on("data", (data) => (error += data.toString()));

    child.on("close", (code) => {
      if (code === 0) {
        resolve(buffer.trim());
      } else {
        reject(new Error(`Command failed: ${command} ${args.join(" ")}\n${error}`));
      }
    });
  });
}
