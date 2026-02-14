import { spawn } from "child_process";

type RunCommandOptions = {
  cwd?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

export async function runCommand(
  command: string,
  args: string[],
  cwd?: string,
  options: RunCommandOptions = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false });
    let output = "";
    let error = "";

    child.stdout.on("data", (data) => {
      const text = data.toString();
      output += text;
      options.onStdout?.(text);
    });
    child.stderr.on("data", (data) => {
      const text = data.toString();
      error += text;
      options.onStderr?.(text);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`Command failed: ${command} ${args.join(" ")}\n${error}`));
      }
    });
  });
}
