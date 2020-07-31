import { bold, dim, reset } from "chalk";

let traceEnabled = false;

export function setTraceEnabled(enabled: boolean) {
  traceEnabled = enabled;
}

export function error(msg: string, ...other: string[]) {
  process.stderr.write(bold.red(msg) + reset(other.join(" ")) + "\n");
}

export function info(msg: string) {
  process.stdout.write(bold.green(msg) + dim(" ") + "\n");
}

export function trace(msg: string) {
  if (traceEnabled) {
    process.stdout.write(dim(msg) + dim(" ") + "\n");
  }
}
